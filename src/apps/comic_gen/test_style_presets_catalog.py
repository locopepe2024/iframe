import json
from pathlib import Path


CATALOG_PATH = Path(__file__).with_name("style_presets.json")
PUBLIC_PATH = Path(__file__).resolve().parents[3] / "frontend" / "public"

EXISTING_IDS = {
    "cinematic_realism", "ecommerce_product_ad", "classic_film_noir",
    "japanese_film_look", "hong_kong_cinema", "symmetric_pastel_cinema",
    "warm_hand_drawn_anime", "modern_cel_anime", "80s_90s_urban_anime",
    "fashion_battle_anime", "stylized_3d_animation", "graphic_novel",
    "painterly_3d_series", "dark_fantasy", "chinese_ink_fantasy",
    "clay_stop_motion",
}

NEW_CHINESE_IDS = {
    "chinese_expressive_wuxia_2d", "chinese_painted_wuxia_2d",
    "chinese_fantasy_painted_2_5d", "chinese_stylized_animation_3d",
}


def test_style_catalog_preserves_existing_ids_and_has_distinct_chinese_styles():
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    categories = {category["id"] for category in catalog["categories"]}
    presets = catalog["presets"]
    by_id = {preset["id"]: preset for preset in presets}

    assert catalog["version"] == 2
    assert len(by_id) == len(presets)
    assert EXISTING_IDS <= by_id.keys()
    assert NEW_CHINESE_IDS <= by_id.keys()
    assert "chinese_animation" in categories
    assert all(preset["category"] in categories for preset in presets)
    assert {preset["id"] for preset in presets if preset["category"] == "chinese_animation"} == NEW_CHINESE_IDS | {"chinese_ink_fantasy"}
    assert all(by_id[preset_id]["positive_prompt"] and by_id[preset_id]["negative_prompt"] for preset_id in NEW_CHINESE_IDS)
    assert len({by_id[preset_id]["visual_family"] for preset_id in NEW_CHINESE_IDS}) == len(NEW_CHINESE_IDS)
    assert all(by_id[preset_id]["genre_tags"] for preset_id in NEW_CHINESE_IDS)
    assert len({by_id[preset_id]["sample_prompt"] for preset_id in NEW_CHINESE_IDS}) == 1
    assert all(not by_id[preset_id]["thumbnail"] for preset_id in NEW_CHINESE_IDS)
    assert all((PUBLIC_PATH / preset["thumbnail"].lstrip("/")).is_file() for preset in presets if preset["thumbnail"])
