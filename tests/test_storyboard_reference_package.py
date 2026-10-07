from src.apps.comic_gen.models import StoryboardFrame, StoryboardReferencePackage


def test_storyboard_frame_has_empty_unconfirmed_reference_package():
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    assert frame.reference_package.revision == 1
    assert frame.reference_package.references == []
    assert frame.reference_package.confirmed is False


def test_reference_package_accepts_scene_frames_and_reference_video():
    package = StoryboardReferencePackage(
        first_frame_url="storyboard/first.png",
        last_frame_url="storyboard/last.png",
        confirmed=True,
        references=[
            {"kind": "scene", "url": "assets/scene.png"},
            {"kind": "reference_video", "url": "uploads/motion.mp4"},
        ],
    )
    assert [item.kind for item in package.references] == ["scene", "reference_video"]
    assert package.confirmed is True
