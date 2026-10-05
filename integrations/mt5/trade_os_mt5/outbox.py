"""Durable account-bound source collections; credentials never belong here.

The collector freezes all pages before committing its local capture cursor.
Upload attempts preserve exact operation IDs and envelopes across restarts.
Changing a lease cannot silently rewrite an uncertain attempt.
"""

import json
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from . import source


class OutboxError(Exception):
    """Intentionally generic: never interpolate source rows or credentials."""


class RecoveryRequired(OutboxError):
    """Look up the original operation after fenced takeover before retrying."""


def _uuid(value: str) -> str:
    try:
        parsed = str(UUID(value))
        if parsed != value.lower():
            raise ValueError
        return parsed
    except (ValueError, AttributeError, TypeError) as error:
        raise OutboxError("Invalid identifier") from error


def _instant(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        raise OutboxError("Invalid UTC checkpoint")
    try:
        datetime.fromisoformat(value)
    except ValueError as error:
        raise OutboxError("Invalid UTC checkpoint") from error
    return value


def _json(value: Any) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError) as error:
        raise OutboxError("Invalid source JSON") from error


@dataclass(frozen=True)
class Binding:
    owner_id: str
    account_id: str
    connection_id: str

    def normalized(self) -> "Binding":
        return Binding(*(_uuid(value) for value in (self.owner_id, self.account_id, self.connection_id)))


class Outbox:
    def __init__(self, path: Path, binding: Binding):
        self.binding = binding.normalized()
        # Explicit SQLite autocommit: transactions below are always deliberate.
        self.db = sqlite3.connect(path, timeout=5, autocommit=True)
        self.db.row_factory = sqlite3.Row
        try:
            self.db.execute("pragma foreign_keys=on")
            if self.db.execute("pragma journal_mode=wal").fetchone()[0] != "wal":
                raise OutboxError("Durable disk outbox required")
            self.db.execute("pragma synchronous=full")
            if self.db.execute("pragma quick_check").fetchone()[0] != "ok":
                raise OutboxError("Outbox requires integrity recovery")
            version = self.db.execute("pragma user_version").fetchone()[0]
            if version not in (0, 1):
                raise OutboxError("Unsupported outbox version")
            with self._transaction():
                self.db.execute("""create table if not exists binding (
                    singleton integer primary key check(singleton=1),
                    owner_id text not null,account_id text not null,connection_id text not null,
                    capture_checkpoint text,server_checkpoint text,identity_json text)""")
                self.db.execute("""create table if not exists collections (
                    sequence integer primary key,id text not null unique,
                    checkpoint text not null,identity_json text not null,batch_count integer not null)""")
                self.db.execute("""create table if not exists pages (
                    collection_id text not null references collections(id),batch_index integer not null,
                    events_json text not null,acknowledged integer not null default 0 check(acknowledged in (0,1)),
                    primary key(collection_id,batch_index))""")
                self.db.execute("""create table if not exists attempts (
                    sequence integer primary key,operation_id text not null unique,
                    collection_id text not null,batch_index integer not null,
                    envelope_json text not null,envelope_hash text not null,
                    receipt_json text,superseded integer not null default 0 check(superseded in (0,1)),
                    foreign key(collection_id,batch_index) references pages(collection_id,batch_index))""")
                row = self.db.execute("select * from binding").fetchone()
                values = (self.binding.owner_id, self.binding.account_id, self.binding.connection_id)
                if row is None:
                    self.db.execute(
                        "insert into binding(singleton,owner_id,account_id,connection_id) values(1,?,?,?)", values
                    )
                elif tuple(row[key] for key in ("owner_id", "account_id", "connection_id")) != values:
                    raise OutboxError("Outbox account mapping mismatch")
                self.db.execute("pragma user_version=1")
        except BaseException:
            self.db.close()
            raise

    @contextmanager
    def _transaction(self) -> Iterator[None]:
        self.db.execute("begin immediate")
        try:
            yield
            self.db.execute("commit")
        except BaseException:
            self.db.execute("rollback")
            raise

    def close(self) -> None:
        self.db.close()

    def enqueue(self, identity: dict[str, Any], checkpoint: str, pages: list[list[dict[str, Any]]]) -> str:
        """Persist a complete frozen collection, not an iterator still collecting.

        The read-only adapter supplies validated, normalized source events and
        verifies terminal identity before AND after collecting them. Server domain
        validation remains authoritative. This layer never invents PnL or plans.
        """
        checkpoint = _instant(checkpoint)
        source.identity(identity)
        if not isinstance(pages, list) or not 1 <= len(pages) <= 100_000:
            raise OutboxError("Invalid collection pages")
        identity_json = _json(identity)
        encoded = []
        for page in pages:
            if not isinstance(page, list) or len(page) > 200:
                raise OutboxError("Invalid collection page")
            keys = set()
            for event in page:
                source.event(event)
                key = (event["kind"], event["sourceId"])
                if key in keys:
                    raise OutboxError("Duplicate source keys in page")
                keys.add(key)
            events_json = _json(page)
            if len(events_json.encode()) + len(identity_json.encode()) > 1_000_000:
                raise OutboxError("Collection page exceeds upload limit")
            encoded.append(events_json)
        collection_id = str(uuid4())
        with self._transaction():
            prior_identity = self.db.execute("select identity_json from binding where singleton=1").fetchone()[0]
            if prior_identity is not None and prior_identity != identity_json:
                raise OutboxError("Outbox terminal identity mismatch")
            if prior_identity is None:
                self.db.execute("update binding set identity_json=? where singleton=1", (identity_json,))
            self.db.execute(
                "insert into collections(id,checkpoint,identity_json,batch_count) values(?,?,?,?)",
                (collection_id, checkpoint, identity_json, len(encoded)),
            )
            self.db.executemany(
                "insert into pages(collection_id,batch_index,events_json) values(?,?,?)",
                ((collection_id, index, page) for index, page in enumerate(encoded)),
            )
            self.db.execute(
                "update binding set capture_checkpoint=max(coalesce(capture_checkpoint,?),?) where singleton=1",
                (checkpoint, checkpoint),
            )
        return collection_id

    def next_attempt(self, worker_id: str, fencing_token: str) -> dict[str, Any] | None:
        worker_id = _uuid(worker_id)
        if not isinstance(fencing_token, str) or not re.fullmatch(r"[1-9][0-9]*", fencing_token):
            raise OutboxError("Invalid fencing token")
        with self._transaction():
            page = self.db.execute("""select p.*,c.checkpoint,c.identity_json,c.batch_count
                from pages p join collections c on c.id=p.collection_id where p.acknowledged=0
                order by c.sequence,p.batch_index limit 1""").fetchone()
            if page is None:
                return None
            prior = self.db.execute(
                """select * from attempts where collection_id=? and batch_index=?
                and superseded=0 order by sequence desc limit 1""",
                (page["collection_id"], page["batch_index"]),
            ).fetchone()
            if prior is not None:
                envelope = json.loads(prior["envelope_json"])
                if sha256(prior["envelope_json"].encode()).hexdigest() != prior["envelope_hash"]:
                    raise OutboxError("Outbox attempt integrity mismatch")
                if envelope["workerId"] != worker_id or envelope["fencingToken"] != fencing_token:
                    raise RecoveryRequired("Uncertain upload requires operation lookup")
                return envelope
            envelope = {
                "connectionId": self.binding.connection_id,
                "workerId": worker_id,
                "fencingToken": fencing_token,
                "operationId": str(uuid4()),
                "identity": json.loads(page["identity_json"]),
                "checkpoint": page["checkpoint"],
                "collection": {"id": page["collection_id"], "index": page["batch_index"], "count": page["batch_count"]},
                "events": json.loads(page["events_json"]),
            }
            serialized = _json(envelope)
            self.db.execute(
                """insert into attempts(operation_id,collection_id,batch_index,envelope_json,envelope_hash)
                values(?,?,?,?,?)""",
                (
                    envelope["operationId"],
                    page["collection_id"],
                    page["batch_index"],
                    serialized,
                    sha256(serialized.encode()).hexdigest(),
                ),
            )
            return envelope

    def acknowledge(self, operation_id: str, result: dict[str, Any]) -> None:
        operation_id = _uuid(operation_id)
        if not isinstance(result, dict):
            raise OutboxError("Invalid upload acknowledgement")
        encoded = _json(result)
        with self._transaction():
            attempt = self.db.execute("select * from attempts where operation_id=?", (operation_id,)).fetchone()
            if attempt is None or attempt["superseded"]:
                raise OutboxError("Unknown upload acknowledgement")
            envelope = json.loads(attempt["envelope_json"])
            manifest = envelope["collection"]
            required = {
                "connectionId",
                "status",
                "revisionCount",
                "checkpoint",
                "collectionId",
                "collectionComplete",
                "receivedBatchCount",
                "reviewCount",
            }
            if (
                set(result) != required
                or result["status"] != "STAGED"
                or result["connectionId"] != self.binding.connection_id
                or result["collectionId"] != manifest["id"]
                or type(result["collectionComplete"]) is not bool
                or any(
                    type(result[key]) is not int or result[key] < 0
                    for key in ("revisionCount", "receivedBatchCount", "reviewCount")
                )
                or not 1 <= result["receivedBatchCount"] <= manifest["count"]
                or result["collectionComplete"] != (result["receivedBatchCount"] == manifest["count"])
            ):
                raise OutboxError("Invalid upload acknowledgement")
            if result["checkpoint"] is not None:
                _instant(result["checkpoint"])
            if attempt["receipt_json"] is not None and attempt["receipt_json"] != encoded:
                raise OutboxError("Conflicting upload acknowledgement")
            self.db.execute("update attempts set receipt_json=? where operation_id=?", (encoded, operation_id))
            self.db.execute(
                "update pages set acknowledged=1 where collection_id=? and batch_index=?",
                (manifest["id"], manifest["index"]),
            )
            if result["collectionComplete"] and result["checkpoint"] is not None:
                checkpoint = result["checkpoint"]
                self.db.execute(
                    "update binding set server_checkpoint=max(coalesce(server_checkpoint,?),?) where singleton=1",
                    (checkpoint, checkpoint),
                )

    def pending_count(self) -> int:
        return self.db.execute("select count(*) from pages where acknowledged=0").fetchone()[0]

    def recover_unknown(self, operation_id: str, lookup: dict[str, Any], worker_id: str, fencing_token: str) -> None:
        """Only after a verified NEW server lease and authenticated UNKNOWN lookup.

        A larger fencing generation makes the old attempt unable to commit after
        this lookup. Preserve that old envelope and atomically store its replacement.
        Never interpret network failures or UNKNOWN alone as permission to rewrite.
        """
        operation_id, worker_id = _uuid(operation_id), _uuid(worker_id)
        if (
            lookup != {"operationId": operation_id, "status": "UNKNOWN"}
            or not isinstance(fencing_token, str)
            or not re.fullmatch(r"[1-9][0-9]*", fencing_token)
        ):
            raise RecoveryRequired("Fenced operation recovery required")
        with self._transaction():
            attempt = self.db.execute("select * from attempts where operation_id=?", (operation_id,)).fetchone()
            if attempt is None or attempt["receipt_json"] is not None or attempt["superseded"]:
                raise RecoveryRequired("Fenced operation recovery required")
            prior = json.loads(attempt["envelope_json"])
            if int(fencing_token) <= int(prior["fencingToken"]):
                raise RecoveryRequired("New fencing generation required")
            if sha256(attempt["envelope_json"].encode()).hexdigest() != attempt["envelope_hash"]:
                raise OutboxError("Outbox attempt integrity mismatch")
            self.db.execute("update attempts set superseded=1 where operation_id=?", (operation_id,))
            replacement = {**prior, "operationId": str(uuid4()), "workerId": worker_id, "fencingToken": fencing_token}
            serialized = _json(replacement)
            self.db.execute(
                """insert into attempts(operation_id,collection_id,batch_index,envelope_json,envelope_hash)
                values(?,?,?,?,?)""",
                (
                    replacement["operationId"],
                    attempt["collection_id"],
                    attempt["batch_index"],
                    serialized,
                    sha256(serialized.encode()).hexdigest(),
                ),
            )

    def checkpoints(self) -> tuple[str | None, str | None]:
        row = self.db.execute("select capture_checkpoint,server_checkpoint from binding where singleton=1").fetchone()
        return row[0], row[1]
