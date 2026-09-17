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

@pytest.mark.parametrize('source', ['series', 'global'])
@pytest.mark.parametrize('kind', ['character', 'scene', 'prop'])
def test_shared_reference_upload_and_selection_save_source(source, kind):
    from src.apps.comic_gen.models import Series, GlobalAssetLibrary
    p, entity = pipeline(kind)
    collection = {'character':'characters','scene':'scenes','prop':'props'}[kind]
    setattr(p.scripts['project'], collection, [])
    p.library_store = GlobalAssetLibrary()
    p._save_series_data = Mock()
    p._save_library_data = Mock()
    if source == 'series':
        p.scripts['project'].series_id = 'series'
        p.series_store = {'series': Series(id='series', title='Series', created_at=1, updated_at=1, owner_user_id='owner', owner_profile_id='owner', **{collection:[entity]})}
    else:
        setattr(p.library_store, collection, [entity])
    upload_type = 'reference_sheet' if kind == 'character' else 'image'
    p.add_uploaded_asset_variant('project', kind, entity.id, upload_type, 'first.png')
    p.add_uploaded_asset_variant('project', kind, entity.id, upload_type, 'second.png')
    variants = entity.reference_sheet.image_variants if kind == 'character' else entity.image_asset.variants
    p.select_asset_variant('project', entity.id, kind, variants[0].id, upload_type)
    assert entity.image_url == 'first.png'
    assert getattr(p.scripts['project'], collection) == []
    saver = p._save_series_data if source == 'series' else p._save_library_data
    assert saver.call_count == 3
    entity.owner_profile_id = 'another-owner'
    if source == 'series': p.series_store['series'].owner_profile_id = 'another-owner'
    with pytest.raises(ValueError, match='not found'):
        p.add_uploaded_asset_variant('project',kind,entity.id,upload_type,'forbidden.png')
    with pytest.raises(ValueError, match='not found'):
        p.select_asset_variant('project',entity.id,kind,variants[1].id,upload_type)
    assert entity.image_url == 'first.png'


def test_shared_upload_response_retains_gallery_and_filters_other_owners(tmp_path, monkeypatch):
    from io import BytesIO
    from fastapi import UploadFile
    from src.apps.comic_gen.models import GlobalAssetLibrary
    from src.apps.identity import UserContext
    from src.apps.studio_access import set_studio_user, reset_studio_user
    monkeypatch.chdir(tmp_path)
    from src.apps.comic_gen import api
    p, entity = pipeline('character')
    p.scripts['project'].characters = []
    other = entity.model_copy(update={'id':'other','owner_profile_id':'stranger'})
    p.library_store = GlobalAssetLibrary(characters=[entity,other])
    p._save_library_data = Mock()
    monkeypatch.setattr(api,'pipeline',p)
    monkeypatch.setattr(api,'signed_response',lambda value: value)
    monkeypatch.setattr(api,'_studio_upload_target',lambda user,name:(str(tmp_path/name),'users/test/'+name))
    monkeypatch.setattr(api,'OSSImageUploader',lambda: Mock(upload_image=Mock(return_value=None)))
    user=UserContext('owner','owner','','')
    token=set_studio_user(user)
    try:
        result=api.upload_asset('project','character','asset','reference_sheet',None,UploadFile(filename='ref.png',file=BytesIO(b'image')),user)
        assert [c['id'] for c in result['characters']] == ['asset']
        char=result['characters'][0]
        assert char['source']=='global'
        variant=char['reference_sheet']['image_variants'][0]
        result=api.select_asset_variant('project',api.SelectVariantRequest(asset_id='asset',asset_type='character',variant_id=variant['id'],generation_type='reference_sheet'))
        assert result['characters'][0]['reference_sheet']['selected_image_id']==variant['id']
        assert not p.scripts['project'].characters
    finally:
        reset_studio_user(token)
