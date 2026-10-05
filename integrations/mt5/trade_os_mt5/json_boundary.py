"""Strict JSON decoding shared by local storage and network boundaries."""


def reject_constant(value):
    raise ValueError("Non-JSON constant")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result
