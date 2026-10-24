"""P0-B / L-1 — storage keys must never resolve outside the storage root.

``LocalStorageAdapter._path`` used ``str(candidate).startswith(str(root))``.
A sibling directory whose name shares the textual prefix (``<root>-evil``)
satisfies that check while living outside the root, so containment must be
decided on path components instead.
"""
from __future__ import annotations

import pytest

from app.errors import ApiError
from app.services.storage import LocalStorageAdapter


def _root(tmp_path):
    root = tmp_path / "storage"
    root.mkdir()
    return root


def _expect_invalid(adapter: LocalStorageAdapter, key: str) -> None:
    with pytest.raises(ApiError) as exc:
        adapter.get(key)
    assert exc.value.code == "file_key_invalid"


def test_normal_key_round_trips(tmp_path):
    adapter = LocalStorageAdapter(str(_root(tmp_path)))

    adapter.put("u/abc.png", b"bytes")

    assert adapter.get("u/abc.png") == b"bytes"
    assert adapter.exists("u/abc.png") is True


def test_parent_traversal_is_rejected(tmp_path):
    adapter = LocalStorageAdapter(str(_root(tmp_path)))

    _expect_invalid(adapter, "../escape.txt")
    _expect_invalid(adapter, "../../escape.txt")


def test_sibling_directory_with_shared_prefix_is_rejected(tmp_path):
    """The regression this fix exists for.

    ``<root>-evil`` starts with ``<root>`` as a string, so the old prefix check
    accepted it even though it is a separate directory.
    """
    root = _root(tmp_path)
    sibling = tmp_path / "storage-evil"
    sibling.mkdir()
    (sibling / "pwned.txt").write_bytes(b"outside")

    assert str(sibling).startswith(str(root))  # the textual prefix the old check used
    adapter = LocalStorageAdapter(str(root))

    _expect_invalid(adapter, "../storage-evil/pwned.txt")
    assert not (root / "pwned.txt").exists()


def test_absolute_path_key_is_rejected(tmp_path):
    root = _root(tmp_path)
    outside = tmp_path / "outside" / "secret.txt"
    outside.parent.mkdir()
    outside.write_bytes(b"secret")
    adapter = LocalStorageAdapter(str(root))

    _expect_invalid(adapter, str(outside))


def test_symlink_escaping_the_root_is_rejected(tmp_path):
    root = _root(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_bytes(b"secret")
    (root / "link").symlink_to(outside, target_is_directory=True)

    adapter = LocalStorageAdapter(str(root))

    _expect_invalid(adapter, "link/secret.txt")


def test_root_itself_keeps_its_previous_behaviour(tmp_path):
    """An empty key resolved to the root before and still does.

    It is not a file, so ``get`` reports "missing" rather than "invalid key" -
    the API contract the router relies on.
    """
    root = _root(tmp_path)
    adapter = LocalStorageAdapter(str(root))

    assert adapter._path("") == root.resolve()
    with pytest.raises(ApiError) as exc:
        adapter.get("")
    assert exc.value.code == "file_missing"


def test_delete_and_exists_also_apply_the_check(tmp_path):
    root = _root(tmp_path)
    sibling = tmp_path / "storage-evil"
    sibling.mkdir()
    (sibling / "pwned.txt").write_bytes(b"outside")
    adapter = LocalStorageAdapter(str(root))

    with pytest.raises(ApiError):
        adapter.delete("../storage-evil/pwned.txt")
    with pytest.raises(ApiError):
        adapter.exists("../storage-evil/pwned.txt")
    # The outside file survived.
    assert (sibling / "pwned.txt").read_bytes() == b"outside"
