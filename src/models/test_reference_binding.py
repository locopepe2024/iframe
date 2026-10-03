import pytest

from src.models.reference_binding import bind_h3_canonical_prompt


def test_h3_compiles_filename_references_to_modality_specific_labels():
    originals = ["family.jpg", "motion.mp4", "room.jpg", "voice.wav"]
    ordered = ["family.jpg", "room.jpg", "motion.mp4", "voice.wav"]
    names = {
        "family.jpg": "家人.jpg",
        "motion.mp4": "动作.mp4",
        "room.jpg": "湖边.jpg",
        "voice.wav": "环境.wav",
    }

    result = bind_h3_canonical_prompt(
        "@家人.jpg 作为身份，@动作.mp4 只提供动作，@湖边.jpg 作为环境，@环境.wav 作为声音。",
        originals,
        ordered,
        names,
    )

    assert result == "<Picture 1> 作为身份，<Video 1> 只提供动作，<Picture 2> 作为环境，<Audio 1> 作为声音。"


def test_h3_rejects_mixed_canonical_and_legacy_syntax():
    with pytest.raises(ValueError, match="cannot mix"):
        bind_h3_canonical_prompt(
            "<Picture 1> and @family.jpg",
            ["family.jpg"],
            ["family.jpg"],
            {"family.jpg": "family.jpg"},
        )


def test_h3_rejects_audio_reference_without_audio_slot_even_in_negative_text():
    with pytest.raises(ValueError, match="Audio reference"):
        bind_h3_canonical_prompt(
            "不要使用 <Audio 1>",
            ["family.jpg"],
            ["family.jpg"],
            {"family.jpg": "family.jpg"},
        )


def test_h3_preserves_subject_business_labels_when_binding_media_references():
    result = bind_h3_canonical_prompt(
        "<Subject 1> is the family; use @family.jpg for identity.",
        ["family.jpg"],
        ["family.jpg"],
        {"family.jpg": "family.jpg"},
    )

    assert result == "<Subject 1> is the family; use <Picture 1> for identity."


def test_h3_resolves_editor_shortened_reference_labels():
    result = bind_h3_canonical_prompt(
        "<Subject 1> is the subject; use @Weixi... for identity and @22291... for motion.",
        ["Weixi_portrait_reference.jpg", "22291_runway_reference.mp4"],
        ["Weixi_portrait_reference.jpg", "22291_runway_reference.mp4"],
        {
            "Weixi_portrait_reference.jpg": "Weixi_portrait_reference.jpg",
            "22291_runway_reference.mp4": "22291_runway_reference.mp4",
        },
    )

    assert result == "<Subject 1> is the subject; use <Picture 1> for identity and <Video 1> for motion."
