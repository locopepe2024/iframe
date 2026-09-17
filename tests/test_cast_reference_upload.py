from unittest.mock import Mock
import pytest
from src.apps.comic_gen.models import Script, Character, Scene, Prop, AssetUnit, ImageVariant
from src.apps.comic_gen.pipeline import ComicGenPipeline


def pipeline(kind):
    p = ComicGenPipeline.__new__(ComicGenPipeline)
    cls = {'character': Character, 'scene': Scene, 'prop': Prop}[kind]
    entity = cls(id='asset', name='Test', description='test', owner_user_id='owner', owner_profile_id='owner')
    script = Script(id='project', title='Test', original_text='test', created_at=1, updated_at=1,
                    owner_user_id='owner', owner_profile_id='owner', **{{'character':'characters','scene':'scenes','prop':'props'}[kind]:[entity]})
    p.scripts = {'project':script}; p._save_data = Mock(); p.series_store = {}
    return p, entity


@pytest.mark.parametrize('kind', ['character','scene','prop'])
def test_uploaded_reference_is_visible_selected_and_keeps_previous_variants(kind):
    p, entity = pipeline(kind)
    upload_type = 'reference_sheet' if kind == 'character' else 'image'
    p.add_uploaded_asset_variant('project',kind,'asset',upload_type,'first.png')
    p.add_uploaded_asset_variant('project',kind,'asset',upload_type,'second.png')
    unit = entity.reference_sheet if kind == 'character' else entity.image_asset
    variants = unit.image_variants if kind == 'character' else unit.variants
    assert [v.url for v in variants] == ['first.png','second.png']
    assert (unit.selected_image_id if kind == 'character' else unit.selected_id) == variants[-1].id
    assert entity.image_url == 'second.png'
    if kind != 'character':
        assert [v.url for v in entity.image_asset.variants] == ['first.png','second.png']
    p.select_asset_variant('project','asset',kind,variants[0].id, 'reference_sheet' if kind=='character' else None)
    assert entity.image_url == 'first.png'
    assert entity.owner_profile_id == 'owner'
