import unittest
from copy import deepcopy

from test_outbox import CHECKPOINT, EVENT, IDENTITY

from trade_os_mt5 import source


class SourceTests(unittest.TestCase):
    def test_broker_tickets_preserve_uint64_without_float_conversion(self):
        self.assertEqual(source.broker_id("18446744073709551615"), "18446744073709551615")
        for invalid in (18_446_744_073_709_551_615, 1.0, "18446744073709551616", "0", "01"):
            with self.subTest(value=invalid), self.assertRaises(source.SourceValidationError):
                source.broker_id(invalid)

    def test_money_prices_and_volume_keep_unrounded_decimal_strings(self):
        for value in ("0.000000000000000001", "-0.005", "1.123456789123456789", "100"):
            self.assertEqual(source.decimal_string(value), value)
        for invalid in (0.1, True, "1e-8", "NaN", "Infinity", "0.0000000000000000001"):
            with self.subTest(value=invalid), self.assertRaises(source.SourceValidationError):
                source.decimal_string(invalid)

    def test_explicit_currency_precision_is_not_assumed_two(self):
        for currency, precision in (("JPY", 0), ("KWD", 3), ("USD", 2)):
            source.identity({**IDENTITY, "currencyCode": currency, "currencyPrecision": precision})

    def test_invalid_or_live_identity_is_rejected(self):
        for field, value in (
            ("accountKind", "LIVE"),
            ("currencyPrecision", True),
            ("currencyPrecision", 9),
            ("login", 12345),
            ("positionMode", "UNKNOWN"),
            ("server", " Broker-Demo"),
        ):
            with self.subTest(field=field), self.assertRaises(source.SourceValidationError):
                source.identity({**IDENTITY, field: value})

    def test_source_identity_and_utc_timestamp_must_match(self):
        for field, value in (("sourceId", "11"), ("observedAt", "2026-01-01T00:00:00+03:00")):
            with self.subTest(field=field), self.assertRaises(source.SourceValidationError):
                source.event({**EVENT, field: value})

    def test_current_stop_remains_management_observation_not_a_planned_stop(self):
        event = {
            "kind": "POSITION",
            "sourceId": "100",
            "observedAt": CHECKPOINT,
            "payload": {
                "positionId": "100",
                "ticket": "10",
                "symbol": "EURUSD",
                "direction": "BUY",
                "volume": "1",
                "entryPrice": "1.1",
                "currentStop": "1.1",
                "currentTarget": None,
                "unrealizedPnl": "0.01",
                "observedAt": CHECKPOINT,
            },
        }
        source.event(event)
        invalid = deepcopy(event)
        invalid["payload"]["planned_stop_loss"] = "1.0"
        with self.assertRaises(source.SourceValidationError):
            source.event(invalid)

    def test_placeholder_or_zero_position_is_not_closure_evidence(self):
        event = {
            "kind": "POSITION",
            "sourceId": "100",
            "observedAt": CHECKPOINT,
            "payload": {
                "positionId": "100",
                "ticket": "10",
                "symbol": "EURUSD",
                "direction": None,
                "volume": "0",
                "entryPrice": "1.1",
                "currentStop": None,
                "currentTarget": None,
                "unrealizedPnl": "0",
                "observedAt": CHECKPOINT,
            },
        }
        with self.assertRaises(source.SourceValidationError):
            source.event(event)

    def test_broker_cash_deals_remain_source_evidence_not_trading_credits(self):
        cash = deepcopy(EVENT)
        cash["payload"].update(type="CREDIT", entry=None, positionId=None, orderId=None, symbol=None, profit="1000")
        source.event(cash)
        self.assertNotIn("tradingCredits", cash["payload"])

    def test_signed_broker_costs_and_explicit_reversal_allocation_are_preserved(self):
        reversal = deepcopy(EVENT)
        reversal["payload"].update(
            entry="INOUT",
            volume="3",
            commission="-3",
            swap="0.05",
            reversalAllocation={
                "closingCommission": "-1",
                "openingCommission": "-2",
                "closingFee": "0",
                "openingFee": "0",
            },
        )
        source.event(reversal)


if __name__ == "__main__":
    unittest.main()
