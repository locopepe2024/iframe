from unittest.mock import Mock

from src.apps.comic_gen.models import GlobalAssetLibrary
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _pipeline():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.library_store = GlobalAssetLibrary()
    pipeline._save_lock = __import__("threading").RLock()
    pipeline._save_library_data_unlocked = Mock()
    pipeline._requested_owner_user_id = lambda: "user-1"
    pipeline._requested_owner_profile_id = lambda *_args: "profile-1"
    return pipeline


def test_avatar_lifecycle_keeps_sources_and_preview_task():
    pipeline = _pipeline()

    avatar = pipeline.create_library_avatar({"name": "Test avatar"})
    assert avatar.status == "draft"
    assert pipeline.list_library_avatars()[0].id == avatar.id

    updated = pipeline.add_avatar_source(
        avatar.id,
        {"media_url": "uploads/source.mp4", "media_type": "video", "duration_seconds": 8.0},
    )
    assert updated.status == "uploaded"
    assert updated.source_media[0].media_type == "video"

    ready = pipeline.process_library_avatar(avatar.id)
    assert ready.status == "ready"
    assert ready.quality_report["diagnostics"] == "local_acceptance_only"

    task = pipeline.create_avatar_preview_task(avatar.id, "你好，欢迎来到 iFrame。")
    assert task.avatar_id == avatar.id
    assert task.status == "queued"
    assert pipeline.get_library_avatar(avatar.id).preview_tasks[0].id == task.id


def test_avatar_preview_requires_source_media():
    pipeline = _pipeline()
    avatar = pipeline.create_library_avatar({"name": "Incomplete"})

    try:
        pipeline.create_avatar_preview_task(avatar.id, "test")
    except ValueError as exc:
        assert "source media" in str(exc)
    else:
        raise AssertionError("preview should require source media")


def test_avatar_appearance_patch_preserves_face_and_body_sections():
    pipeline = _pipeline()
    avatar = pipeline.create_library_avatar({"name": "Appearance"})

    updated = pipeline.update_avatar_appearance(avatar.id, {
        "face": {"face_shape": "oval", "hair_color": "black"},
        "body": {"body_type": "athletic", "height_cm": 175},
        "extraction_source": "manual",
    })

    assert updated.appearance.face.face_shape == "oval"
    assert updated.appearance.face.hair_color == "black"
    assert updated.appearance.body.body_type == "athletic"
    assert updated.appearance.body.height_cm == 175
