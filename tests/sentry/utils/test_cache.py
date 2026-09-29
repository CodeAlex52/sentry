from __future__ import annotations

import pytest

from sentry.utils.cache import cache_key_for_event, event_from_cache_key


def test_round_trips_cache_key_for_event() -> None:
    data = {"event_id": "a" * 32, "project": 42}

    assert event_from_cache_key(cache_key_for_event(data)) == (42, "a" * 32)


@pytest.mark.parametrize(
    "cache_key",
    ["", "e", "e:abc", "e:abc:123:456", "x:abc:123", "e:abc:notanint"],
)
def test_returns_none_for_unexpected_shapes(cache_key: str) -> None:
    assert event_from_cache_key(cache_key) is None
