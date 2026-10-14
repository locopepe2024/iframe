from .uniart_catalog import normalize_uniart_catalog


def test_local_gateway_models_have_media_capabilities():
    models = normalize_uniart_catalog({"data": [
        {"id": "seedream_5.0Pro_nsfw", "supported_endpoint_types": ["openai"]},
        {"id": "wan3.0", "supported_endpoint_types": ["openai"]},
        {"id": "wan3.0-Prime", "supported_endpoint_types": ["openai"]},
        {"id": "deepseek-v4-flash", "supported_endpoint_types": ["openai"]},
    ]})

    by_id = {model["api_model_id"]: model for model in models}
    assert by_id["seedream_5.0Pro_nsfw"]["id"] == "nsfw/seedream_5.0Pro_nsfw"
    assert by_id["seedream_5.0Pro_nsfw"]["provider"] == "nsfw"
    assert by_id["seedream_5.0Pro_nsfw"]["capabilities"] == ["t2i", "i2i"]
    assert by_id["seedream_5.0Pro_nsfw"]["params"]["size"]["options"] == ["1k", "2k"]
    for model_id in ("wan3.0", "wan3.0-Prime"):
        assert by_id[model_id]["id"] == f"nsfw/{model_id}"
        assert by_id[model_id]["capabilities"] == ["t2v", "i2v", "r2v"]
        assert by_id[model_id]["duration"]["default"] == 4
        assert by_id[model_id]["params"]["resolution"]["options"][0] == "480p"
    assert by_id["deepseek-v4-flash"]["capabilities"] == ["chat"]
