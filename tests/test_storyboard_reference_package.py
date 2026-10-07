from src.apps.comic_gen.models import StoryboardFrame, StoryboardReferencePackage


def test_storyboard_frame_has_empty_unconfirmed_reference_package():
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    assert frame.reference_package.revision == 1
    assert frame.reference_package.references == []
    assert frame.reference_package.confirmed is False


def test_reference_package_accepts_scene_frames_and_reference_video():
    package = StoryboardReferencePackage(
        first_frame_url="storyboard/first.png",
        first_frame_media_id="media-first",
        last_frame_url="storyboard/last.png",
        last_frame_media_id="media-last",
        confirmed=True,
        references=[
            {"kind": "scene", "url": "assets/scene.png", "media_id": "media-scene"},
            {"kind": "reference_video", "url": "uploads/motion.mp4", "media_id": "media-motion"},
        ],
    )
    assert [item.kind for item in package.references] == ["scene", "reference_video"]
    assert package.confirmed is True
    assert package.first_frame_media_id == "media-first"
    assert package.last_frame_media_id == "media-last"
    assert [item.media_id for item in package.references] == ["media-scene", "media-motion"]
