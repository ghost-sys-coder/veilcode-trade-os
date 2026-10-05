"""Strict transport normalization only; authoritative finance stays in TypeScript."""

import re
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID


class SourceValidationError(ValueError):
    pass


def instant(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        raise SourceValidationError("Invalid UTC source timestamp")
    try:
        datetime.fromisoformat(value)
    except ValueError as error:
        raise SourceValidationError("Invalid UTC source timestamp") from error
    return value


def broker_id(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not re.fullmatch(r"[1-9][0-9]{0,19}", value)
        or int(value) > 18_446_744_073_709_551_615
    ):
        raise SourceValidationError("Invalid broker identifier")
    return value


def decimal_string(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?", value):
        raise SourceValidationError("Invalid source decimal string")
    return value


def _text(value: Any, limit: int) -> None:
    if not isinstance(value, str) or not 1 <= len(value) <= limit:
        raise SourceValidationError("Invalid source text")


def identity(value: Any) -> None:
    fields = {
        "server",
        "login",
        "terminalInstallationId",
        "currencyCode",
        "currencyPrecision",
        "accountKind",
        "positionMode",
    }
    if not isinstance(value, dict) or set(value) != fields:
        raise SourceValidationError("Invalid terminal identity")
    _text(value["server"], 255)
    broker_id(value["login"])
    if value["server"] != value["server"].strip():
        raise SourceValidationError("Invalid broker server")
    try:
        UUID(value["terminalInstallationId"])
    except (ValueError, AttributeError, TypeError) as error:
        raise SourceValidationError("Invalid terminal installation") from error
    if (
        not isinstance(value["currencyCode"], str)
        or not re.fullmatch(r"[A-Z]{3}", value["currencyCode"])
        or type(value["currencyPrecision"]) is not int
        or not 0 <= value["currencyPrecision"] <= 20
        or value["accountKind"] != "DEMO"
        or value["positionMode"] not in ("HEDGING", "NETTING")
    ):
        raise SourceValidationError("Unapproved terminal identity")


def event(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {"kind", "sourceId", "observedAt", "payload"}:
        raise SourceValidationError("Invalid source envelope")
    _text(value["sourceId"], 128)
    instant(value["observedAt"])
    kind, payload = value["kind"], value["payload"]
    if not isinstance(payload, dict):
        raise SourceValidationError("Invalid source payload")
    if kind == "DEAL":
        fields = {
            "ticket",
            "orderId",
            "positionId",
            "symbol",
            "occurredAt",
            "type",
            "entry",
            "volume",
            "price",
            "profit",
            "commission",
            "swap",
            "fee",
        }
        optional = {"reversalAllocation"}
        money = ("volume", "price", "profit", "commission", "swap", "fee")
        ids, timestamps = ("ticket", "orderId", "positionId"), ("occurredAt",)
    elif kind == "ORDER":
        fields = {
            "ticket",
            "positionId",
            "positionById",
            "symbol",
            "type",
            "state",
            "initialVolume",
            "remainingVolume",
            "price",
            "stopLoss",
            "takeProfit",
            "setupAt",
            "doneAt",
        }
        optional = set()
        money = ("initialVolume", "remainingVolume", "price", "stopLoss", "takeProfit")
        ids, timestamps = ("ticket", "positionId", "positionById"), ("setupAt", "doneAt")
    elif kind == "POSITION":
        fields = {
            "positionId",
            "ticket",
            "symbol",
            "direction",
            "volume",
            "entryPrice",
            "currentStop",
            "currentTarget",
            "unrealizedPnl",
            "observedAt",
        }
        optional = set()
        money = ("volume", "entryPrice", "currentStop", "currentTarget", "unrealizedPnl")
        ids, timestamps = ("positionId", "ticket"), ("observedAt",)
    elif kind == "ACCOUNT":
        fields = {"balance", "equity", "unrealizedPnl", "observedAt"}
        optional = set()
        money = ("balance", "equity", "unrealizedPnl")
        ids, timestamps = (), ("observedAt",)
    else:
        raise SourceValidationError("Unsupported source kind")
    if not fields <= set(payload) or set(payload) - fields - optional:
        raise SourceValidationError("Invalid source fields")
    for field in money:
        if payload[field] is None and field in ("stopLoss", "takeProfit", "currentStop", "currentTarget"):
            continue
        decimal_string(payload[field])
    for field in ids:
        if payload[field] is None and field != "ticket" and kind != "POSITION":
            continue
        broker_id(payload[field])
    for field in timestamps:
        if field == "doneAt" and payload[field] is None:
            continue
        instant(payload[field])
    if kind != "ACCOUNT":
        if payload["symbol"] is not None or kind != "DEAL":
            _text(payload["symbol"], 128)
        if value["sourceId"] != payload["positionId" if kind == "POSITION" else "ticket"]:
            raise SourceValidationError("Source identity mismatch")
    if kind == "DEAL":
        _text(payload["type"], 48)
        if payload["entry"] not in (None, "IN", "OUT", "INOUT", "OUT_BY"):
            raise SourceValidationError("Invalid deal entry")
        if "reversalAllocation" in payload:
            allocation = payload["reversalAllocation"]
            if not isinstance(allocation, dict) or set(allocation) != {
                "closingCommission",
                "openingCommission",
                "closingFee",
                "openingFee",
            }:
                raise SourceValidationError("Invalid reversal allocation")
            for amount in allocation.values():
                decimal_string(amount)
    if kind == "ORDER":
        _text(payload["type"], 48)
        _text(payload["state"], 48)
    if kind == "POSITION" and (payload["direction"] not in ("BUY", "SELL") or Decimal(payload["volume"]) <= 0):
        raise SourceValidationError("Invalid position direction or volume")
    if kind in ("POSITION", "ACCOUNT") and payload["observedAt"] != value["observedAt"]:
        raise SourceValidationError("Observation timestamp mismatch")
    if kind == "ACCOUNT" and value["sourceId"] != "ACCOUNT":
        raise SourceValidationError("Invalid account observation key")
