"""Read-only adapter for one explicitly approved dedicated demo terminal.

No auto-discovery, account login/switching, broker credentials or execution API.
Native broker floats are converted to source decimal strings, not used for PnL.
Call this in a supervised process: native IPC can stall beyond its own timeout.
"""

import importlib
import os
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from . import source

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
DEAL_TYPES = (
    "BUY",
    "SELL",
    "BALANCE",
    "CREDIT",
    "CHARGE",
    "CORRECTION",
    "BONUS",
    "COMMISSION",
    "COMMISSION_DAILY",
    "COMMISSION_MONTHLY",
    "COMMISSION_AGENT_DAILY",
    "COMMISSION_AGENT_MONTHLY",
    "INTEREST",
    "BUY_CANCELED",
    "SELL_CANCELED",
    "DIVIDEND",
    "DIVIDEND_FRANKED",
    "TAX",
)
ORDER_TYPES = (
    "BUY",
    "SELL",
    "BUY_LIMIT",
    "SELL_LIMIT",
    "BUY_STOP",
    "SELL_STOP",
    "BUY_STOP_LIMIT",
    "SELL_STOP_LIMIT",
    "CLOSE_BY",
)
ORDER_STATES = (
    "STARTED",
    "PLACED",
    "CANCELED",
    "PARTIAL",
    "FILLED",
    "REJECTED",
    "EXPIRED",
    "REQUEST_ADD",
    "REQUEST_MODIFY",
    "REQUEST_CANCEL",
)


class BrokerError(Exception):
    def __init__(self, code: str, *, retryable: bool = False):
        self.code, self.retryable = code, retryable
        super().__init__(code)


def native_decimal(value: Any) -> str:
    """Represent the native scalar without currency rounding or binary arithmetic."""
    if type(value) not in (int, float) and not isinstance(value, Decimal):
        raise BrokerError("INVALID_BROKER_FACT")
    try:
        decimal = Decimal(str(value))
        if not decimal.is_finite() or decimal.adjusted() > 17 or decimal.as_tuple().exponent < -18:
            raise ValueError
        result = format(decimal, "f")
        # Native negative zero is zero, not a losing outcome.
        if decimal.is_zero():
            result = "0"
        source.decimal_string(result)
        return result
    except (InvalidOperation, ValueError):
        raise BrokerError("INVALID_BROKER_FACT") from None


def native_id(value: Any, *, nullable: bool = False) -> str | None:
    if type(value) is not int:
        raise BrokerError("INVALID_BROKER_IDENTIFIER")
    if nullable and value == 0:
        return None
    try:
        return source.broker_id(str(value))
    except ValueError:
        raise BrokerError("INVALID_BROKER_IDENTIFIER") from None


def native_time(milliseconds: Any, *, nullable: bool = False) -> str | None:
    if type(milliseconds) is not int or milliseconds < 0:
        raise BrokerError("INVALID_BROKER_TIMESTAMP")
    if nullable and milliseconds == 0:
        return None
    try:
        return (EPOCH + timedelta(milliseconds=milliseconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (OverflowError, ValueError):
        raise BrokerError("INVALID_BROKER_TIMESTAMP") from None


def _rows(result: Any) -> tuple:
    if result is None:
        raise BrokerError("BROKER_READ_UNAVAILABLE", retryable=True)
    if not isinstance(result, tuple | list):
        raise BrokerError("INVALID_BROKER_RESPONSE")
    return tuple(result)


def _enum(module: Any, prefix: str, names: tuple[str, ...], value: Any) -> str:
    if type(value) is not int or value < 0:
        raise BrokerError("INVALID_BROKER_ENUM")
    for name in names:
        if getattr(module, prefix + name, None) == value:
            return name
    # Preserve unsupported broker codes as reviewable evidence, never guess BUY.
    return "UNKNOWN_" + str(value)


def _stop(value: Any) -> str | None:
    normalized = native_decimal(value)
    return None if Decimal(normalized).is_zero() else normalized


@dataclass(frozen=True)
class TerminalBinding:
    executable: Path
    data_path: Path
    identity: dict[str, Any]
    dedicated_approved: bool
    portable: bool = False

    def validate(self) -> None:
        try:
            source.identity(self.identity)
            if (
                self.dedicated_approved is not True
                or type(self.portable) is not bool
                or not self.executable.is_absolute()
                or not self.data_path.is_absolute()
                or self.executable.name.lower() not in ("terminal64.exe", "terminal.exe")
                or not self.executable.is_file()
                or not self.data_path.is_dir()
            ):
                raise ValueError
        except (ValueError, OSError, AttributeError):
            raise BrokerError("UNAPPROVED_TERMINAL_CONFIGURATION") from None


@dataclass(frozen=True)
class Collection:
    identity: dict[str, Any]
    checkpoint: str
    pages: list[list[dict[str, Any]]]


class ReadOnlyTerminal:
    def __init__(self, binding: TerminalBinding, *, module: Any = None):
        binding.validate()
        self.binding = replace(binding, identity=dict(binding.identity))
        self._module = module
        self._connected = False

    def connect(self) -> None:
        if self._connected:
            self._verify_identity()
            return
        if self._module is None:
            if os.name != "nt":
                raise BrokerError("WINDOWS_TERMINAL_REQUIRED")
            try:
                self._module = importlib.import_module("MetaTrader5")
            except ImportError:
                raise BrokerError("METATRADER_PACKAGE_REQUIRED") from None
        try:
            # Never omit the approved path and never pass login/password/server.
            if (
                self._module.initialize(
                    str(self.binding.executable.resolve()), timeout=15_000, portable=self.binding.portable
                )
                is not True
            ):
                raise BrokerError("BROKER_CONNECT_UNAVAILABLE", retryable=True)
            self._connected = True
            self._verify_identity()
        except BrokerError:
            self.close()
            raise
        except Exception:
            self.close()
            raise BrokerError("BROKER_CONNECT_UNAVAILABLE", retryable=True) from None

    def close(self) -> None:
        if self._connected:
            self._connected = False
            try:
                self._module.shutdown()
            except Exception:
                pass  # No terminal process termination or restart here.

    def _verify_identity(self) -> Any:
        try:
            terminal, account = self._module.terminal_info(), self._module.account_info()
            if terminal is None or account is None or terminal.connected is not True:
                raise BrokerError("BROKER_READ_UNAVAILABLE", retryable=True)
            if (
                not Path(terminal.path).is_absolute()
                or not Path(terminal.data_path).is_absolute()
                or Path(terminal.path).resolve() != self.binding.executable.resolve().parent
                or Path(terminal.data_path).resolve() != self.binding.data_path.resolve()
            ):
                raise BrokerError("TERMINAL_INSTALLATION_MISMATCH")
            demo = getattr(self._module, "ACCOUNT_TRADE_MODE_DEMO", None)
            hedge = getattr(self._module, "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING", None)
            net = getattr(self._module, "ACCOUNT_MARGIN_MODE_RETAIL_NETTING", None)
            if demo is None or type(account.trade_mode) is not int or account.trade_mode != demo:
                raise BrokerError("DEMO_ACCOUNT_REQUIRED")
            if type(account.margin_mode) is not int or account.margin_mode not in (hedge, net):
                raise BrokerError("UNSUPPORTED_POSITION_MODE")
            actual = {
                "server": account.server,
                "login": native_id(account.login),
                "terminalInstallationId": self.binding.identity["terminalInstallationId"],
                "currencyCode": account.currency,
                "currencyPrecision": account.currency_digits,
                "accountKind": "DEMO",
                "positionMode": "HEDGING" if account.margin_mode == hedge else "NETTING",
            }
            source.identity(actual)
            if actual != self.binding.identity:
                raise BrokerError("MT5_ACCOUNT_IDENTITY_MISMATCH")
            return account
        except BrokerError:
            raise
        except Exception:
            raise BrokerError("INVALID_BROKER_IDENTITY") from None

    def _read(self, call, *args) -> tuple:
        self._verify_identity()
        try:
            result = _rows(call(*args))
        except BrokerError:
            raise
        except Exception:
            raise BrokerError("BROKER_READ_UNAVAILABLE", retryable=True) from None
        self._verify_identity()
        return result

    def collect(self, *, now: datetime, checkpoint: str | None = None, full_history: bool = False) -> Collection:
        """Freeze successful history + observations, verifying every query's account.

        First capture and daily wider reconciliation start at the Unix epoch.
        Incremental polls overlap by five minutes; history failures never become
        empty successful collections. Empty positions are observations, not proof
        of canonical closure. Publication requires the full server deal history.
        """
        if not self._connected:
            raise BrokerError("BROKER_NOT_CONNECTED")
        if now.tzinfo is None or type(full_history) is not bool:
            raise BrokerError("INVALID_COLLECTION_WINDOW")
        end = now.astimezone(UTC)
        observed = end.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        try:
            source.instant(observed)
            start = EPOCH
            if checkpoint is not None:
                source.instant(checkpoint)
                prior = datetime.fromisoformat(checkpoint)
                if prior > end:
                    raise ValueError
                if not full_history:
                    start = max(EPOCH, prior - timedelta(minutes=5))
            if end < EPOCH:
                raise ValueError
        except ValueError:
            raise BrokerError("INVALID_COLLECTION_WINDOW") from None
        self._verify_identity()
        module = self._module
        deals = self._read(module.history_deals_get, start, end)
        history_orders = self._read(module.history_orders_get, start, end)
        active_orders = self._read(module.orders_get)
        positions = self._read(module.positions_get)
        account = self._verify_identity()
        try:
            events = [self._deal(row, observed) for row in deals]
            orders = {native_id(row.ticket): row for row in history_orders}
            if len(orders) != len(history_orders):
                raise BrokerError("DUPLICATE_BROKER_FACT")
            # Current order facts can revise an already captured order ticket.
            current = {native_id(row.ticket): row for row in active_orders}
            if len(current) != len(active_orders):
                raise BrokerError("DUPLICATE_BROKER_FACT")
            orders.update(current)
            events.extend(self._order(row, observed) for row in orders.values())
            events.extend(self._position(row, observed) for row in positions)
            events.append(
                {
                    "kind": "ACCOUNT",
                    "sourceId": "ACCOUNT",
                    "observedAt": observed,
                    "payload": {
                        "balance": native_decimal(account.balance),
                        "equity": native_decimal(account.equity),
                        "unrealizedPnl": native_decimal(account.profit),
                        "observedAt": observed,
                    },
                }
            )
            keys = set()
            for event in events:
                source.event(event)
                key = (event["kind"], event["sourceId"])
                if key in keys:
                    raise BrokerError("DUPLICATE_BROKER_FACT")
                keys.add(key)
            self._verify_identity()
            return Collection(
                dict(self.binding.identity),
                observed,
                [events[index : index + 200] for index in range(0, len(events), 200)],
            )
        except BrokerError:
            raise
        except Exception:
            raise BrokerError("INVALID_BROKER_FACT") from None

    def _deal(self, row, observed: str) -> dict:
        kind = _enum(self._module, "DEAL_TYPE_", DEAL_TYPES, row.type)
        entry = _enum(self._module, "DEAL_ENTRY_", ("IN", "OUT", "INOUT", "OUT_BY"), row.entry)
        if entry.startswith("UNKNOWN_"):
            kind = f"TYPE_{row.type}_ENTRY_{row.entry}"
            entry = None
        return {
            "kind": "DEAL",
            "sourceId": native_id(row.ticket),
            "observedAt": observed,
            "payload": {
                "ticket": native_id(row.ticket),
                "orderId": native_id(row.order, nullable=True),
                "positionId": native_id(row.position_id, nullable=True),
                "symbol": row.symbol or None,
                "type": kind,
                "entry": entry,
                "occurredAt": native_time(row.time_msc),
                **{
                    key: native_decimal(getattr(row, key))
                    for key in ("volume", "price", "profit", "commission", "swap", "fee")
                },
            },
        }

    def _order(self, row, observed: str) -> dict:
        return {
            "kind": "ORDER",
            "sourceId": native_id(row.ticket),
            "observedAt": observed,
            "payload": {
                "ticket": native_id(row.ticket),
                "positionId": native_id(row.position_id, nullable=True),
                "positionById": native_id(row.position_by_id, nullable=True),
                "symbol": row.symbol,
                "type": _enum(self._module, "ORDER_TYPE_", ORDER_TYPES, row.type),
                "state": _enum(self._module, "ORDER_STATE_", ORDER_STATES, row.state),
                "initialVolume": native_decimal(row.volume_initial),
                "remainingVolume": native_decimal(row.volume_current),
                "price": native_decimal(row.price_open),
                "stopLoss": _stop(row.sl),
                "takeProfit": _stop(row.tp),
                "setupAt": native_time(row.time_setup_msc),
                "doneAt": native_time(row.time_done_msc, nullable=True),
            },
        }

    def _position(self, row, observed: str) -> dict:
        direction = _enum(self._module, "POSITION_TYPE_", ("BUY", "SELL"), row.type)
        if direction not in ("BUY", "SELL"):
            raise BrokerError("UNSUPPORTED_POSITION_TYPE")
        return {
            "kind": "POSITION",
            "sourceId": native_id(row.identifier),
            "observedAt": observed,
            "payload": {
                "positionId": native_id(row.identifier),
                "ticket": native_id(row.ticket),
                "symbol": row.symbol,
                "direction": direction,
                "volume": native_decimal(row.volume),
                "entryPrice": native_decimal(row.price_open),
                "currentStop": _stop(row.sl),
                "currentTarget": _stop(row.tp),
                "unrealizedPnl": native_decimal(row.profit),
                "observedAt": observed,
            },
        }
