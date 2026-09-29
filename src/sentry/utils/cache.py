from collections.abc import Mapping
from typing import Any, TypeVar

from django.core.cache import cache

__all__ = ["cache", "default_cache", "cache_key_for_event", "event_from_cache_key"]

default_cache = cache

T = TypeVar("T")


def cache_key_for_event(data: Mapping[str, Any]) -> str:
    return "e:{}:{}".format(data["event_id"], data["project"])


def event_from_cache_key(cache_key: str) -> tuple[int, str] | None:
    """
    Inverse of `cache_key_for_event`, for pipeline steps that have lost the event body
    and only hold its cache key. Returns `(project_id, event_id)`, or None if the key
    is not in that shape. Never raises; callers are already on an error path.
    """
    parts = cache_key.split(":")
    if len(parts) != 3 or parts[0] != "e":
        return None
    try:
        return int(parts[2]), parts[1]
    except ValueError:
        return None
