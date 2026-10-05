import json
import sqlite3
import subprocess
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

from trade_os_mt5.outbox import Binding, Outbox, OutboxError, RecoveryRequired
from trade_os_mt5.source import SourceValidationError

OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
CONNECTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
WORKER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
NEW_WORKER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CHECKPOINT = "2026-01-01T00:00:00.000Z"
IDENTITY = {
    "server": "Broker-Demo",
    "login": "12345",
    "terminalInstallationId": OWNER,
    "currencyCode": "USD",
    "currencyPrecision": 2,
    "accountKind": "DEMO",
    "positionMode": "NETTING",
}
EVENT = {
    "kind": "DEAL",
    "sourceId": "10",
    "observedAt": CHECKPOINT,
    "payload": {
        "ticket": "10",
        "orderId": "10",
        "positionId": "100",
        "symbol": "EURUSD",
        "occurredAt": CHECKPOINT,
        "type": "BUY",
        "entry": "IN",
        "volume": "1",
        "price": "1.1",
        "profit": "0",
        "commission": "-2",
        "swap": "0",
        "fee": "0",
    },
}


def receipt(attempt, *, complete=False, count=1, checkpoint=None):
    return {
        "connectionId": CONNECTION,
        "status": "STAGED",
        "revisionCount": 1,
        "checkpoint": checkpoint,
        "collectionId": attempt["collection"]["id"],
        "collectionComplete": complete,
        "receivedBatchCount": count,
        "reviewCount": 0,
    }


class OutboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-outbox-test-")
        self.path = Path(self.temp.name) / "outbox.sqlite3"
        self.binding = Binding(OWNER, ACCOUNT, CONNECTION)
        self.box = Outbox(self.path, self.binding)

    def tearDown(self):
        self.box.close()
        self.temp.cleanup()

    def reopen(self):
        self.box.close()
        self.box = Outbox(self.path, self.binding)

    def test_wal_full_and_integrity_are_enabled(self):
        self.assertEqual(self.box.db.execute("pragma journal_mode").fetchone()[0], "wal")
        self.assertEqual(self.box.db.execute("pragma synchronous").fetchone()[0], 2)
        self.assertEqual(self.box.db.execute("pragma foreign_keys").fetchone()[0], 1)

    def test_whole_collection_and_capture_cursor_survive_reopen(self):
        collection_id = self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT], [], []])
        self.reopen()
        self.assertEqual(self.box.pending_count(), 3)
        self.assertEqual(self.box.checkpoints(), (CHECKPOINT, None))
        attempt = self.box.next_attempt(WORKER, "1")
        self.assertEqual(attempt["collection"], {"id": collection_id, "index": 0, "count": 3})

    def test_invalid_later_page_cannot_commit_earlier_pages_or_cursor(self):
        with self.assertRaises(SourceValidationError):
            self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT], [{"kind": "DEAL"}]])
        self.assertEqual(self.box.pending_count(), 0)
        self.assertEqual(self.box.checkpoints(), (None, None))

    def test_sql_failure_rolls_back_all_pages_and_cursor(self):
        self.box.db.execute("""create trigger fail_later before insert on pages when new.batch_index=1
            begin select raise(abort,'fixture interruption'); end""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT], []])
        self.assertEqual(self.box.pending_count(), 0)
        self.assertEqual(self.box.checkpoints(), (None, None))

    def test_spool_cannot_be_opened_for_another_account(self):
        with self.assertRaises(OutboxError):
            Outbox(self.path, Binding(OWNER, NEW_WORKER, CONNECTION))

    def test_switched_broker_identity_cannot_join_same_spool(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[]])
        with self.assertRaises(OutboxError):
            self.box.enqueue({**IDENTITY, "login": "67890"}, CHECKPOINT, [[]])
        self.assertEqual(self.box.pending_count(), 1)

    def test_source_credentials_and_float_money_are_not_persisted(self):
        for mutation in (
            lambda value: value["payload"].update(access_token="not-a-real-secret"),
            lambda value: value["payload"].update(commission=-2.0),
        ):
            value = deepcopy(EVENT)
            mutation(value)
            with self.assertRaises(SourceValidationError):
                self.box.enqueue(IDENTITY, CHECKPOINT, [[value]])
        self.assertEqual(self.box.pending_count(), 0)

    def test_duplicate_source_keys_are_rejected_within_a_page(self):
        with self.assertRaises(OutboxError):
            self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT, EVENT]])

    def test_lost_acknowledgement_reuses_exact_envelope_after_reopen(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        prior = self.box.next_attempt(WORKER, "1")
        self.reopen()
        self.assertEqual(self.box.next_attempt(WORKER, "1"), prior)

    def test_changed_lease_never_silently_rewrites_uncertain_operation(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.box.next_attempt(WORKER, "1")
        for worker, fence in ((NEW_WORKER, "1"), (WORKER, "2"), (NEW_WORKER, "2")):
            with self.assertRaises(RecoveryRequired):
                self.box.next_attempt(worker, fence)

    def test_unknown_without_new_fencing_generation_cannot_supersede(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        attempt = self.box.next_attempt(WORKER, "1")
        lookup = {"operationId": attempt["operationId"], "status": "UNKNOWN"}
        with self.assertRaises(RecoveryRequired):
            self.box.recover_unknown(attempt["operationId"], lookup, NEW_WORKER, "1")
        self.assertEqual(self.box.next_attempt(WORKER, "1"), attempt)

    def test_fenced_unknown_recovery_preserves_old_attempt_and_slot(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        prior = self.box.next_attempt(WORKER, "1")
        self.box.recover_unknown(
            prior["operationId"], {"operationId": prior["operationId"], "status": "UNKNOWN"}, NEW_WORKER, "2"
        )
        self.reopen()
        replacement = self.box.next_attempt(NEW_WORKER, "2")
        self.assertNotEqual(prior["operationId"], replacement["operationId"])
        self.assertEqual(prior["collection"], replacement["collection"])
        self.assertEqual(prior["events"], replacement["events"])
        old = self.box.db.execute(
            "select envelope_json,superseded from attempts where operation_id=?", (prior["operationId"],)
        ).fetchone()
        self.assertEqual(json.loads(old[0]), prior)
        self.assertEqual(old[1], 1)
        with self.assertRaises(RecoveryRequired):
            self.box.next_attempt(WORKER, "1")

    def test_committed_receipt_is_acknowledged_not_reenveloped(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        prior = self.box.next_attempt(WORKER, "1")
        result = receipt(prior, complete=True, checkpoint=CHECKPOINT)
        self.box.acknowledge(prior["operationId"], result)
        self.reopen()
        self.assertIsNone(self.box.next_attempt(NEW_WORKER, "2"))
        self.assertEqual(self.box.checkpoints(), (CHECKPOINT, CHECKPOINT))

    def test_partial_collection_ack_does_not_advance_server_cursor(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT], []])
        first = self.box.next_attempt(WORKER, "1")
        self.box.acknowledge(first["operationId"], receipt(first))
        self.assertEqual(self.box.checkpoints(), (CHECKPOINT, None))
        last = self.box.next_attempt(WORKER, "1")
        self.box.acknowledge(last["operationId"], receipt(last, complete=True, count=2, checkpoint=CHECKPOINT))
        self.assertEqual(self.box.checkpoints(), (CHECKPOINT, CHECKPOINT))
        self.assertEqual(self.box.pending_count(), 0)

    def test_ack_is_idempotent_but_conflicting_receipt_is_rejected(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[]])
        attempt = self.box.next_attempt(WORKER, "1")
        result = receipt(attempt, complete=True, checkpoint=CHECKPOINT)
        self.box.acknowledge(attempt["operationId"], result)
        self.box.acknowledge(attempt["operationId"], result)
        with self.assertRaises(OutboxError):
            self.box.acknowledge(attempt["operationId"], {**result, "revisionCount": 2})

    def test_wrong_account_or_collection_receipt_never_acknowledges(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[]])
        attempt = self.box.next_attempt(WORKER, "1")
        result = receipt(attempt, complete=True, checkpoint=CHECKPOINT)
        for field in ("connectionId", "collectionId"):
            with self.assertRaises(OutboxError):
                self.box.acknowledge(attempt["operationId"], {**result, field: NEW_WORKER})
        self.assertEqual(self.box.pending_count(), 1)

    def test_complete_collection_can_be_blocked_by_an_older_server_gap(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[]])
        attempt = self.box.next_attempt(WORKER, "1")
        self.box.acknowledge(attempt["operationId"], receipt(attempt, complete=True, checkpoint=None))
        self.assertEqual(self.box.pending_count(), 0)
        self.assertEqual(self.box.checkpoints(), (CHECKPOINT, None))

    def test_newer_checkpoint_cannot_regress_on_older_collection(self):
        newer = "2026-02-01T00:00:00.000Z"
        for timestamp in (newer, CHECKPOINT):
            self.box.enqueue(IDENTITY, timestamp, [[]])
            attempt = self.box.next_attempt(WORKER, "1")
            self.box.acknowledge(attempt["operationId"], receipt(attempt, complete=True, checkpoint=timestamp))
        self.assertEqual(self.box.checkpoints(), (newer, newer))

    def test_process_death_rolls_back_open_sqlite_transaction(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        code = """import os,sqlite3,sys
db=sqlite3.connect(sys.argv[1],autocommit=True)
db.execute('begin immediate')
db.execute('update pages set acknowledged=1')
os._exit(17)
"""
        process = subprocess.run([sys.executable, "-c", code, str(self.path)], check=False, capture_output=True)
        self.assertEqual(process.returncode, 17)
        self.reopen()
        self.assertEqual(self.box.pending_count(), 1)

    def test_tampered_attempt_is_detected_before_upload(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.box.next_attempt(WORKER, "1")
        self.box.db.execute("update attempts set envelope_hash=?", ("0" * 64,))
        with self.assertRaises(OutboxError):
            self.box.next_attempt(WORKER, "1")

    def test_pages_are_fifo_across_collections(self):
        first = self.box.enqueue(IDENTITY, CHECKPOINT, [[], []])
        self.box.enqueue(IDENTITY, CHECKPOINT, [[]])
        attempt = self.box.next_attempt(WORKER, "1")
        self.assertEqual(attempt["collection"]["id"], first)
        self.box.acknowledge(attempt["operationId"], receipt(attempt))
        self.assertEqual(self.box.next_attempt(WORKER, "1")["collection"], {"id": first, "index": 1, "count": 2})


if __name__ == "__main__":
    unittest.main()
