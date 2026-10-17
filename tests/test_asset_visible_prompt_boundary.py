from fastapi import BackgroundTasks, HTTPException
import pytest

from src.apps.comic_gen import api


@pytest.mark.parametrize("prompt,apply_style,preserve_prompt", [
    ("", False, True),
    ("Reviewed prompt", True, True),
    ("Reviewed prompt", False, False),
])
def test_manual_asset_image_routes_reject_hidden_or_blank_prompt(prompt, apply_style, preserve_prompt):
    request = api.GenerateAssetRequest(asset_id="scene", asset_type="scene", prompt=prompt,
                                       apply_style=apply_style, preserve_prompt=preserve_prompt)
    for endpoint in (api.generate_single_asset, api.generate_series_asset):
        with pytest.raises(HTTPException) as exc:
            endpoint("project", request, BackgroundTasks())
        assert exc.value.status_code == 422


def test_manual_character_all_mode_cannot_create_unreviewed_derived_prompts():
    request = api.GenerateAssetRequest(asset_id="character", asset_type="character", generation_type="all",
                                       prompt="Reviewed portrait", apply_style=False, preserve_prompt=True)
    with pytest.raises(HTTPException) as exc:
        api.generate_single_asset("project", request, BackgroundTasks())
    assert exc.value.status_code == 422


def test_legacy_batch_route_cannot_generate_unreviewed_asset_prompts():
    with pytest.raises(HTTPException) as exc:
        api.generate_assets("project", BackgroundTasks())
    assert exc.value.status_code == 422
