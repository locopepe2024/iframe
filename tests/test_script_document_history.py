from pathlib import Path


def _doc(text: str):
    return {
        "type": "doc",
        "content": [{"type": "action", "content": [{"type": "text", "text": text}]}],
    }


def test_snapshot_restore_preserves_replaced_document_and_returns_editor_contract(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    project_id = "story-opening"
    first = _doc("开端：雨夜，沈夏在车站等一通没有接通的电话。")
    second = _doc("开端：沈夏已经离开车站，城市灯光在车窗外后退。")

    saved = api.save_document(project_id, api.SaveDocumentRequest(content=first))
    assert saved["status"] == "ok"
    created = api.create_document_snapshot(project_id)
    timestamp = created["timestamp"]

    api.save_document(project_id, api.SaveDocumentRequest(content=second))
    restored = api.restore_document_snapshot(project_id, timestamp)

    assert restored["project_id"] == project_id
    assert restored["content"] == first
    assert restored["updated_at"]

    snapshots = api.list_document_snapshots(project_id)
    assert len(snapshots) == 2
    assert all(snapshot.created_at for snapshot in snapshots)
    assert all(snapshot.size_bytes > 0 for snapshot in snapshots)

    # The document remains writable after a restore.
    api.save_document(project_id, api.SaveDocumentRequest(content=restored["content"]))
    loaded = api.load_document(project_id)
    assert loaded["content"] == first


def test_snapshot_timestamps_do_not_overwrite_same_second(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    project_id = "rapid-edits"
    api.save_document(project_id, api.SaveDocumentRequest(content=_doc("v1")))

    first = api.create_document_snapshot(project_id)
    api.save_document(project_id, api.SaveDocumentRequest(content=_doc("v2")))
    second = api.create_document_snapshot(project_id)

    assert first["timestamp"] != second["timestamp"]
    assert len(api.list_document_snapshots(project_id)) == 2


def test_legacy_project_opens_with_editable_source_text(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    monkeypatch.setattr(
        api,
        "pipeline",
        SimpleNamespace(get_script=lambda project_id: SimpleNamespace(
            id=project_id,
            original_text="故事的开端：沈夏在车站等电话。\n她最终转身离开。",
        )),
    )

    loaded = api.load_document("legacy-opening")

    assert loaded["content"]["type"] == "doc"
    assert [block["content"][0]["text"] for block in loaded["content"]["content"]] == [
        "故事的开端：沈夏在车站等电话。",
        "她最终转身离开。",
    ]
