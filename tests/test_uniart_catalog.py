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
        "uniart/gpt-image-2",
    ]
    assert models[0]["capabilities"] == ["t2i", "i2i"]
    assert models[0]["params"]["size"]["options"] == ["1k", "2k", "4k"]


def test_image_25_reference_limit_comes_from_public_image_capability():
    models = normalize_uniart_catalog({"data": [{
        "id": "gpt-image-2.5-flare",
        "image_capability": {"supports_generation": True, "supports_edit": True, "supports_mask": True, "max_input_images": 16},
    }]})
    assert models[0]["inputs"]["reference_images"]["max"] == 16
