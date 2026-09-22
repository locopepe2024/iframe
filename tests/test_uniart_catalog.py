from src.utils.uniart_catalog import normalize_uniart_catalog


def test_normalizes_authoritative_video_capabilities():
    models = normalize_uniart_catalog({"data": [{
        "id": "seedance-2.5-vip",
        "video_capability": {
            "modes": [
                {"id": "text_to_video"},
                {"id": "image_to_video"},
                {"id": "image_reference"},
                {"id": "omni_reference"},
                {"id": "first_last_frame"},
            ],
            "resolutions": ["480p", "720p", "1080p"],
            "ratios": ["16:9", "9:16", "1:1"],
            "ratios_by_resolution": {"1080p": ["16:9", "9:16", "1:1"]},
            "durations": list(range(4, 31)),
            "default_resolution": "720p",
            "default_ratio": "16:9",
            "default_duration": 4,
            "supports_generate_audio": True,
            "max_reference_images": 30,
        },
    }]})

    assert len(models) == 1
    model = models[0]
    assert model["capabilities"] == ["t2v", "i2v", "r2v", "f2v"]
    assert model["params"]["resolution"]["options"] == ["480p", "720p", "1080p"]
    assert model["params"]["ratiosByResolution"]["1080p"] == ["16:9", "9:16", "1:1"]
    assert model["duration"] == {"type": "slider", "min": 4, "max": 30, "step": 1, "default": 4}
    assert model["params"]["audio"] is True
    assert model["inputs"]["reference_images"]["max"] == 30


def test_normalizes_image_models_only_from_image_capability():
    models = normalize_uniart_catalog({"data": [
        {"id": "gpt-image-2", "image_capability": {"resolutions": ["1k", "2k", "4k"], "supports_generation": True, "supports_edit": True}},
        # Some UniArt video catalog entries contain image_generation/image_edit
        # labels for an upstream route, but they are not image API capabilities.
        {"id": "gpt-image-2.5-sunburst-special", "video_capability": {"modes": [{"id": "image_generation"}, {"id": "image_edit"}], "resolutions": ["1k", "2k", "4k"]}},
        {"id": "gpt-5.6-sol", "supported_endpoint_types": ["openai"]},
    ]})

    assert [model["id"] for model in models] == [
        "uniart/gpt-image-2", "uniart/gpt-image-2.5-sunburst-special", "uniart/gpt-5.6-sol",
    ]
    assert models[0]["capabilities"] == ["t2i", "i2i"]
    assert models[0]["params"]["size"]["options"] == ["1k", "2k", "4k"]


def test_image_25_reference_limit_comes_from_public_image_capability():
    models = normalize_uniart_catalog({"data": [{
        "id": "gpt-image-2.5-flare",
        "image_capability": {"supports_generation": True, "supports_edit": True, "supports_mask": True, "max_input_images": 16},
    }]})
    assert models[0]["inputs"]["reference_images"]["max"] == 16

def test_preserves_chat_only_skus_from_uniart_models():
    models = normalize_uniart_catalog({"data": [
        {"id": "qwen3.8-flash"},
        {"id": "chatgpt-6"},
        {"id": "deepseek-v4"},
        {"id": "glm-5"},
        {"id": "minimax-speed-hd"},
        {"id": "minimax-turbo"},
    ]})
    assert [model["api_model_id"] for model in models] == [
        "qwen3.8-flash", "chatgpt-6", "deepseek-v4", "glm-5", "minimax-speed-hd", "minimax-turbo",
    ]
    assert [model["capabilities"] for model in models] == [["chat"], ["chat"], ["chat"], ["chat"], ["audio"], ["audio"]]


def test_classifies_minimax_speed_audio_skus():
    models = normalize_uniart_catalog({"data": [
        {"id": "minimax-speed-hd"},
        {"id": "minimax-speed-turbo"},
        {"id": "minimax-chat"},
    ]})
    assert models[0]["capabilities"] == ["audio"]
    assert models[1]["capabilities"] == ["audio"]
    assert models[2]["capabilities"] == ["chat"]

def test_gpt_image_route_aliases_remain_image_models_without_capability_block():
    models = normalize_uniart_catalog({"data": [
        {"id": "gpt-image-2.5-flare-discount"},
        {"id": "gpt-image-2.5-flare-special"},
    ]})
    assert all(model["capabilities"] == ["t2i", "i2i"] for model in models)


def test_false_audio_metadata_still_exposes_optional_audio_control():
    model = normalize_uniart_catalog({"data": [{
        "id": "minimax-h3-vip",
        "video_capability": {"modes": [{"id": "omni_reference"}], "supports_generate_audio": False},
    }]})[0]
    assert model["params"]["audio"] is True
