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


def test_h3_normalizes_mixed_canonical_and_editor_syntax():
    assert bind_h3_canonical_prompt(
        "<Picture 1> and @family.jpg",
        ["family.jpg"],
        ["family.jpg"],
        {"family.jpg": "family.jpg"},
    ) == "<Picture 1> and <Picture 1>"


@pytest.mark.parametrize("mention", ["@素材-7d...", "@素材-7d…", "@1"])
def test_h3_keeps_agent_ir_labels_when_binding_appended_reference(mention):
    prompt = "subject_definitions:\n<Picture 1> is the first frame of [Shot 1].\n<Subject 1> is the street in <Picture 1>.\n" + mention
    assert bind_h3_canonical_prompt(
        prompt, ["street.webp"], ["street.webp"], {"street.webp": "素材-7d12345"},
    ) == prompt.removesuffix(mention) + "<Picture 1>"


def test_h3_mixed_syntax_respects_modality_order_without_renumbering_canonical():
    assert bind_h3_canonical_prompt(
        "<Picture 2> <Video 1> @1 @2 @3 @4",
        ["move.mp4", "street.webp", "horse.jpg", "hooves.wav"],
        ["street.webp", "horse.jpg", "move.mp4", "hooves.wav"], {},
    ) == "<Picture 2> <Video 1> <Video 1> <Picture 1> <Picture 2> <Audio 1>"


@pytest.mark.parametrize(("prompt", "names", "error"), [
    ("<Picture 1> @missing", {}, "unresolved"),
    ("<Picture 1> @3", {}, "outside"),
    ("<Picture 3> @1", {}, "outside"),
    ("<Picture 1> @素材-7d...", {"a.jpg": "素材-7d111", "b.jpg": "素材-7d222"}, "duplicate names"),
])
def test_h3_mixed_syntax_still_rejects_invalid_references(prompt, names, error):
    with pytest.raises(ValueError, match=error):
        bind_h3_canonical_prompt(prompt, ["a.jpg", "b.jpg"], ["a.jpg", "b.jpg"], names)


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
