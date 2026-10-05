import unittest
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from test_outbox import ACCOUNT, CONNECTION, IDENTITY, OWNER

from trade_os_mt5.broker import (
    EPOCH,
    BrokerError,
    ReadOnlyTerminal,
    TerminalBinding,
    native_decimal,
    native_id,
    native_time,
)
from trade_os_mt5.outbox import Binding, Outbox

NOW = datetime(2026, 1, 2, 12, tzinfo=UTC)


def deal(**changes):
    return SimpleNamespace(
        **{
            "ticket": 10,
            "order": 20,
            "position_id": 30,
            "symbol": "EURUSD",
            "type": 0,
            "entry": 0,
            "time_msc": 1767355200123,
            "volume": 0.1,
            "price": 1.0875,
            "profit": 0.0,
            "commission": -0.01,
            "swap": 0.0,
            "fee": 0.0,
            **changes,
        }
    )


def order(**changes):
    return SimpleNamespace(
        **{
            "ticket": 20,
            "position_id": 30,
            "position_by_id": 0,
            "symbol": "EURUSD",
            "type": 0,
            "state": 4,
            "time_setup_msc": 1767355200000,
            "time_done_msc": 1767355200123,
            "volume_initial": 0.1,
            "volume_current": 0.0,
            "price_open": 1.0875,
            "sl": 1.084,
            "tp": 0.0,
            **changes,
        }
    )


def position(**changes):
    return SimpleNamespace(
        **{
            "identifier": 30,
            "ticket": 31,
            "symbol": "EURUSD",
            "type": 0,
            "volume": 0.1,
            "price_open": 1.0875,
            "sl": 1.0875,
            "tp": 0.0,
            "profit": 0.001,
            **changes,
        }
    )


class FakeTerminal:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_MARGIN_MODE_RETAIL_HEDGING = 2
    ACCOUNT_MARGIN_MODE_RETAIL_NETTING = 0
    DEAL_TYPE_BUY = 0
    DEAL_TYPE_SELL = 1
    DEAL_TYPE_BALANCE = 2
    DEAL_TYPE_CREDIT = 3
    DEAL_TYPE_BUY_CANCELED = 13
    DEAL_ENTRY_IN = 0
    DEAL_ENTRY_OUT = 1
    DEAL_ENTRY_INOUT = 2
    DEAL_ENTRY_OUT_BY = 3
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_TYPE_CLOSE_BY = 8
    ORDER_STATE_FILLED = 4
    ORDER_STATE_PLACED = 1
    POSITION_TYPE_BUY = 0
    POSITION_TYPE_SELL = 1

    def __init__(self, executable, data_path):
        self.account = SimpleNamespace(
            login=int(IDENTITY["login"]),
            server=IDENTITY["server"],
            currency="USD",
            currency_digits=2,
            trade_mode=0,
            margin_mode=0,
            balance=1000.0,
            equity=1000.001,
            profit=0.001,
        )
        self.terminal = SimpleNamespace(connected=True, path=str(executable.parent), data_path=str(data_path))
        self.deals, self.history_orders, self.active_orders, self.positions = (deal(),), (order(),), (), (position(),)
        self.calls = []
        self.after = {}
        self.initialize_ok = True

    def initialize(self, *args, **kwargs):
        self.calls.append(("initialize", args, kwargs))
        return self.initialize_ok

    def shutdown(self):
        self.calls.append(("shutdown",))

    def terminal_info(self):
        return self.terminal

    def account_info(self):
        return self.account

    def _read(self, name, result, args):
        self.calls.append((name, args))
        if name in self.after:
            self.after[name]()
        return result

    def history_deals_get(self, *args):
        return self._read("deals", self.deals, args)

    def history_orders_get(self, *args):
        return self._read("history_orders", self.history_orders, args)

    def orders_get(self):
        return self._read("orders", self.active_orders, ())

    def positions_get(self):
        return self._read("positions", self.positions, ())

    # Any accidentally introduced account change or execution crashes a test.
    def login(self, *args, **kwargs):
        raise AssertionError("Account switching forbidden")

    def order_send(self, *args, **kwargs):
        raise AssertionError("Broker execution forbidden")

    def order_check(self, *args, **kwargs):
        raise AssertionError("Broker execution forbidden")


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-broker-test-")
        self.root = Path(self.temp.name)
        self.executable = self.root / "terminal64.exe"
        self.executable.touch()
        self.data = self.root / "data"
        self.data.mkdir()
        self.binding = TerminalBinding(self.executable, self.data, dict(IDENTITY), True)
        self.module = FakeTerminal(self.executable, self.data)
        self.reader = ReadOnlyTerminal(self.binding, module=self.module)

    def tearDown(self):
        self.reader.close()
        self.temp.cleanup()

    def test_initialize_uses_only_explicit_dedicated_path_not_login_or_discovery(self):
        self.reader.connect()
        self.assertEqual(
            self.module.calls,
            [("initialize", (str(self.executable.resolve()),), {"timeout": 15000, "portable": False})],
        )
        self.reader.collect(now=NOW)
        self.assertEqual(
            [call[0] for call in self.module.calls], ["initialize", "deals", "history_orders", "orders", "positions"]
        )

    def test_unapproved_or_relative_configuration_never_initializes(self):
        for binding in (
            replace(self.binding, dedicated_approved=False),
            replace(self.binding, executable=Path("terminal64.exe")),
            replace(self.binding, data_path=Path("data")),
            replace(self.binding, executable=self.root / "missing.exe"),
        ):
            with self.subTest(binding=binding), self.assertRaises(BrokerError):
                ReadOnlyTerminal(binding, module=self.module)
        self.assertEqual(self.module.calls, [])

    def test_live_account_wrong_login_server_currency_precision_and_mode_rejected(self):
        cases = {
            "trade_mode": 2,
            "login": 999,
            "server": "Other-Demo",
            "currency": "GBP",
            "currency_digits": 3,
            "margin_mode": 2,
        }
        for key, value in cases.items():
            original = getattr(self.module.account, key)
            setattr(self.module.account, key, value)
            with self.subTest(key=key), self.assertRaises(BrokerError):
                self.reader.connect()
            self.assertFalse(self.reader._connected)
            setattr(self.module.account, key, original)

    def test_wrong_installation_or_shared_data_directory_rejected(self):
        for key in ("path", "data_path"):
            original = getattr(self.module.terminal, key)
            setattr(self.module.terminal, key, str(self.root.parent))
            with self.subTest(key=key), self.assertRaises(BrokerError) as error:
                self.reader.connect()
            self.assertEqual(error.exception.code, "TERMINAL_INSTALLATION_MISMATCH")
            setattr(self.module.terminal, key, original)

    def test_identity_switch_during_each_read_discards_all_rows_and_outbox_cursor(self):
        self.reader.connect()
        box = Outbox(self.root / "outbox.sqlite3", Binding(OWNER, ACCOUNT, CONNECTION))
        try:
            for method in ("deals", "history_orders", "orders", "positions"):
                self.module.after = {method: lambda: setattr(self.module.account, "login", 999)}
                with self.subTest(method=method), self.assertRaises(BrokerError) as error:
                    collected = self.reader.collect(now=NOW)
                    box.enqueue(collected.identity, collected.checkpoint, collected.pages)
                self.assertEqual(error.exception.code, "MT5_ACCOUNT_IDENTITY_MISMATCH")
                self.assertEqual(box.checkpoints(), (None, None))
                self.module.account.login = int(IDENTITY["login"])
        finally:
            box.close()

    def test_none_query_is_failure_not_successful_empty_collection(self):
        self.reader.connect()
        for attribute in ("deals", "history_orders", "active_orders", "positions"):
            original = getattr(self.module, attribute)
            setattr(self.module, attribute, None)
            with self.subTest(attribute=attribute), self.assertRaises(BrokerError) as error:
                self.reader.collect(now=NOW)
            self.assertTrue(error.exception.retryable)
            setattr(self.module, attribute, original)

    def test_disconnected_terminal_requires_reconnect_not_cached_identity(self):
        self.reader.connect()
        self.module.terminal.connected = False
        with self.assertRaises(BrokerError) as error:
            self.reader.collect(now=NOW)
        self.assertTrue(error.exception.retryable)

    def test_all_history_first_then_overlap_and_daily_wider_reconciliation(self):
        self.reader.connect()
        checkpoint = "2026-01-02T11:59:00.000Z"
        self.reader.collect(now=NOW)
        self.assertEqual(self.module.calls[1][1], (EPOCH, NOW))
        self.module.calls.clear()
        self.reader.collect(now=NOW, checkpoint=checkpoint)
        self.assertEqual(self.module.calls[0][1], (datetime.fromisoformat(checkpoint) - timedelta(minutes=5), NOW))
        self.module.calls.clear()
        self.reader.collect(now=NOW, checkpoint=checkpoint, full_history=True)
        self.assertEqual(self.module.calls[0][1], (EPOCH, NOW))

    def test_naive_time_or_future_checkpoint_is_rejected_before_history_reads(self):
        self.reader.connect()
        for values in ({"now": NOW.replace(tzinfo=None)}, {"now": NOW, "checkpoint": "2026-01-03T00:00:00.000Z"}):
            with self.subTest(values=values), self.assertRaises(BrokerError):
                self.reader.collect(**values)
        self.assertEqual(len(self.module.calls), 1)

    def test_uint64_ids_and_source_decimals_preserve_precision_and_management_not_plans(self):
        self.module.deals = (deal(ticket=18446744073709551615, profit=0.001, commission=-0.0001),)
        self.reader.connect()
        capture = self.reader.collect(now=NOW)
        events = capture.pages[0]
        self.assertEqual(events[0]["sourceId"], "18446744073709551615")
        self.assertEqual(events[0]["payload"]["profit"], "0.001")
        self.assertEqual(events[0]["payload"]["commission"], "-0.0001")
        self.assertEqual(events[2]["payload"]["positionId"], "30")
        self.assertEqual(events[2]["payload"]["ticket"], "31")
        self.assertEqual(events[2]["payload"]["currentStop"], "1.0875")
        self.assertNotIn("plannedStop", str(events))
        self.assertEqual(events[-1]["payload"]["balance"], "1000.0")
        self.assertEqual(events[0]["payload"]["occurredAt"], "2026-01-02T12:00:00.123Z")

    def test_current_order_observation_revises_same_ticket_without_duplicate_key(self):
        self.module.active_orders = (order(state=1, sl=1.086, time_done_msc=0),)
        self.reader.connect()
        rows = [event for event in self.reader.collect(now=NOW).pages[0] if event["kind"] == "ORDER"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["payload"]["state"], "PLACED")
        self.assertEqual(rows[0]["payload"]["stopLoss"], "1.086")
        self.assertIsNone(rows[0]["payload"]["doneAt"])

    def test_unknown_and_canceled_deals_and_broker_credit_remain_reviewable_source(self):
        self.module.deals = (
            deal(type=13),
            deal(ticket=11, type=99),
            deal(ticket=12, entry=99),
            deal(ticket=13, type=3, order=0, position_id=0, symbol="", profit=100),
        )
        self.reader.connect()
        deals = self.reader.collect(now=NOW).pages[0][:4]
        self.assertEqual(
            [event["payload"]["type"] for event in deals], ["BUY_CANCELED", "UNKNOWN_99", "TYPE_0_ENTRY_99", "CREDIT"]
        )
        self.assertIsNone(deals[2]["payload"]["entry"])
        self.assertIsNone(deals[3]["payload"]["positionId"])
        self.assertIsNone(deals[3]["payload"]["symbol"])
        self.assertNotIn("tradingCredits", str(deals))

    def test_close_by_and_reversal_enum_evidence_is_preserved(self):
        self.module.deals = (
            deal(entry=2),
            deal(ticket=11, entry=3),
        )
        self.module.history_orders = (order(type=8, position_by_id=40),)
        self.reader.connect()
        rows = self.reader.collect(now=NOW).pages[0]
        self.assertEqual([row["payload"]["entry"] for row in rows[:2]], ["INOUT", "OUT_BY"])
        self.assertEqual(rows[2]["payload"]["type"], "CLOSE_BY")
        self.assertEqual(rows[2]["payload"]["positionById"], "40")

    def test_pages_are_bounded_and_entire_capture_can_be_enqueued_atomically(self):
        self.module.deals = tuple(deal(ticket=ticket) for ticket in range(1, 402))
        self.reader.connect()
        collected = self.reader.collect(now=NOW)
        self.assertEqual([len(page) for page in collected.pages], [200, 200, 4])
        box = Outbox(self.root / "outbox.sqlite3", Binding(OWNER, ACCOUNT, CONNECTION))
        try:
            box.enqueue(collected.identity, collected.checkpoint, collected.pages)
            self.assertEqual(box.pending_count(), 3)
        finally:
            box.close()

    def test_duplicate_deals_or_unknown_position_type_cannot_advance_capture(self):
        self.reader.connect()
        self.module.deals = (deal(), deal())
        with self.assertRaises(BrokerError) as error:
            self.reader.collect(now=NOW)
        self.assertEqual(error.exception.code, "DUPLICATE_BROKER_FACT")
        self.module.deals = ()
        self.module.positions = (position(type=99),)
        with self.assertRaises(BrokerError) as error:
            self.reader.collect(now=NOW)
        self.assertEqual(error.exception.code, "UNSUPPORTED_POSITION_TYPE")

    def test_duplicate_orders_do_not_silently_discard_broker_evidence(self):
        self.reader.connect()
        for attribute in ("history_orders", "active_orders"):
            original = getattr(self.module, attribute)
            setattr(self.module, attribute, (order(), order(sl=1.085)))
            with self.subTest(attribute=attribute), self.assertRaises(BrokerError) as error:
                self.reader.collect(now=NOW)
            self.assertEqual(error.exception.code, "DUPLICATE_BROKER_FACT")
            setattr(self.module, attribute, original)

    def test_caller_cannot_retarget_reader_by_mutating_original_identity(self):
        self.binding.identity["login"] = "999"
        self.reader.connect()
        self.assertEqual(self.reader.collect(now=NOW).identity["login"], IDENTITY["login"])

    def test_explicit_hedging_demo_identity_can_collect_without_mode_guessing(self):
        self.reader.close()
        mapped = {**IDENTITY, "positionMode": "HEDGING"}
        self.module.account.margin_mode = self.module.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING
        reader = ReadOnlyTerminal(replace(self.binding, identity=mapped), module=self.module)
        try:
            reader.connect()
            self.assertEqual(reader.collect(now=NOW).identity, mapped)
        finally:
            reader.close()

    def test_native_scalar_validation_rejects_nan_infinity_strings_and_float_ids(self):
        for value in (float("nan"), float("inf"), True, "0.1", 1e19, 1e-19):
            with self.subTest(value=value), self.assertRaises(BrokerError):
                native_decimal(value)
        self.assertEqual(native_decimal(-0.0), "0")
        self.assertEqual(native_decimal(Decimal("0.00000001")), "0.00000001")
        for value in (True, 1.0, 0, -1, 18446744073709551616):
            with self.subTest(value=value), self.assertRaises(BrokerError):
                native_id(value)
        self.assertIsNone(native_id(0, nullable=True))
        for value in (1.0, -1, 10**30):
            with self.assertRaises(BrokerError):
                native_time(value)


if __name__ == "__main__":
    unittest.main()
