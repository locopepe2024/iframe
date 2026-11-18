from pathlib import Path
from threading import RLock
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import Character, CharacterDesignPage, GlobalAssetLibrary, ImageAsset, ImageVariant, Script, Series
from src.apps.comic_gen.pipeline import ComicGenPipeline


def pipeline_for(tmp_path, scope='project'):
    character = Character(id='hero', name='Hero', description='Character description', owner_profile_id='owner',
        custom_design_pages=[CharacterDesignPage(id='costume', name='蓝衣造型', prompt='蓝外套，举手').model_dump()],
        full_body_asset=ImageAsset(selected_id='master', variants=[ImageVariant(id='master', url='master.png')]),
        full_body_image_url='master.png', full_body_prompt='Original master prompt', is_consistent=True)
    project = Script(id='project', title='Episode', original_text='', created_at=0, updated_at=0, characters=[character], owner_profile_id='owner')
    series = Series(id='series', title='Series', created_at=0, updated_at=0, characters=[character], owner_profile_id='owner')
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.output_root = str(tmp_path)
    pipeline.scripts = {'project': project}; pipeline.series_store = {'series': series}
    pipeline.get_series = lambda ident, *_: pipeline.series_store.get(ident)
    pipeline.library_store = GlobalAssetLibrary()
    pipeline._save_lock = RLock(); pipeline.asset_generation_tasks = {}
    pipeline._save_data = Mock(); pipeline._save_series_data = Mock(); pipeline._save_series_data_unlocked = Mock()
    pipeline._save_after_asset_mutation = Mock(); pipeline._register_asset_media = Mock()
    pipeline.effective_director_profile = lambda *_: None
    generator = AssetGenerator(output_root=str(tmp_path))
    provider = Mock()
    def generate(prompt, output_path, **kwargs):
        Path(output_path).write_bytes(b'image')
        return output_path, 0.1
    provider.generate.side_effect = generate
    generator._get_model_for = lambda _: provider
    pipeline.asset_generator = generator
    return pipeline, character, provider


@pytest.mark.parametrize('scope', ['project', 'series'])
def test_design_page_generates_exact_authored_prompt_without_changing_master(tmp_path, monkeypatch, scope):
    pipeline, character, provider = pipeline_for(tmp_path, scope)
    monkeypatch.setattr('src.utils.oss_utils.OSSImageUploader', lambda: Mock(is_configured=False))
    prompt = '服装：红色外套\n动作：侧身抬手，半身构图'
    review = pipeline.preview_asset_image_submission(scope, 'hero', 'character', prompt=prompt, negative_prompt='披风',
        generation_type='design:costume', is_series=scope == 'series')
    assert review['positive_prompt'] == prompt
    create = pipeline.create_asset_generation_task if scope == 'project' else pipeline.generate_series_asset
    _, task_id = create(scope, 'hero', 'character', generation_type='design:costume', prompt=prompt,
        negative_prompt='披风', preserve_prompt=True, apply_style=False, expected_review_fingerprint=review['fingerprint'])
    pipeline.process_asset_generation_task(task_id)
    task = pipeline.asset_generation_tasks[task_id]
    assert task['status'] == 'completed', task.get('error')
    assert provider.generate.call_args.args[0] == prompt
    assert provider.generate.call_args.kwargs['negative_prompt'] == '披风'
    variant = character.full_body_asset.variants[0]
    assert variant.design_page_id == 'costume'
    assert variant.submission_snapshot.generation_type == 'design:costume'
    assert variant.submission_snapshot.positive_prompt == prompt
    assert character.full_body_asset.selected_id == 'master'
    assert character.full_body_image_url == 'master.png'
    assert character.full_body_prompt == 'Original master prompt'
    assert character.is_consistent is True
    restored = Character.model_validate_json(character.model_dump_json())
    assert restored.custom_design_pages[0]['prompt'] == '蓝外套，举手'
    assert restored.full_body_asset.variants[0].design_page_id == 'costume'


def test_closed_design_page_rejects_new_generation_but_keeps_generated_images(tmp_path):
    pipeline, character, _ = pipeline_for(tmp_path)
    character.full_body_asset.variants.append(ImageVariant(id='costume-image', url='costume.png', design_page_id='costume'))
    pipeline.update_asset_attributes('project', 'hero', 'character', {'custom_design_pages': []})
    assert any(v.id == 'costume-image' for v in character.full_body_asset.variants)
    with pytest.raises(ValueError, match='closed or unavailable'):
        pipeline.preview_asset_image_submission('project', 'hero', 'character', prompt='new outfit', generation_type='design:costume')
    with pytest.raises(ValueError, match='closed or unavailable'):
        pipeline.create_asset_generation_task('project', 'hero', 'character', prompt='new outfit', generation_type='design:costume')


@pytest.mark.parametrize('scope', ['project', 'series'])
def test_design_page_validation_and_persistence_use_existing_asset_owner(tmp_path, scope):
    pipeline, character, _ = pipeline_for(tmp_path)
    update = pipeline.update_asset_attributes if scope == 'project' else pipeline.update_series_asset_attributes
    update(scope, 'hero', 'character', {'custom_design_pages': [{'id':'action', 'name':'动作参考', 'prompt':'挥手',
        'references':[{'asset_type':'character','asset_id':'hero','variant_id':'master'}], 'mode':'reference'}]})
    assert Character.model_validate_json(character.model_dump_json()).custom_design_pages[0]['references'][0]['variant_id'] == 'master'
    before = character.custom_design_pages
    with pytest.raises((ValueError, ValidationError)):
        update(scope, 'hero', 'character', {'custom_design_pages': [{'id':'../bad'}]})
    assert character.custom_design_pages == before
    with pytest.raises(ValueError, match='unique'):
        update(scope, 'hero', 'character', {'custom_design_pages':[{'id':'same'},{'id':'same'}]})


def test_custom_images_survive_candidate_pruning_and_do_not_inherit_uploaded_views(tmp_path, monkeypatch):
    pipeline, character, provider = pipeline_for(tmp_path)
    monkeypatch.setattr('src.utils.oss_utils.OSSImageUploader', lambda: Mock(is_configured=False))
    character.full_body_asset.variants.extend(ImageVariant(id=f'look-{i}', url=f'look-{i}.png', design_page_id='other') for i in range(15))
    uploaded = tmp_path/'uploaded.png'; uploaded.write_bytes(b'input')
    character.headshot_asset = ImageAsset(variants=[ImageVariant(id='uploaded', url=str(uploaded), is_uploaded_source=True)])
    pipeline.asset_generator.generate_character(character, generation_type='design:costume', prompt='换白衣', image_generation_mode='text')
    assert len(character.full_body_asset.variants) == 17
    assert provider.generate.call_args.kwargs['ref_image_path'] is None
    assert character.full_body_asset.selected_id == 'master'

@pytest.mark.parametrize('scope', ['project', 'series'])
def test_custom_reference_prompt_edits_are_not_replaced_by_hidden_semantics(tmp_path, monkeypatch, scope):
    from src.apps.reference_materials import materialize_image
    from PIL import Image
    pipeline, character, provider = pipeline_for(tmp_path, scope)
    monkeypatch.setattr('src.utils.oss_utils.OSSImageUploader', lambda: Mock(is_configured=False))
    image = tmp_path/'source.png'; Image.new('RGB', (8, 8)).save(image)
    reference = materialize_image('owner', str(image), output_root=str(tmp_path),
        context={'title':'Reference costume','semantics':{'clothing':'blue'}})['reference']
    pipeline._reference_semantic_prompt = Mock(side_effect=AssertionError('Custom page may not append hidden semantics'))
    pipeline.scripts['project'].model_settings.t2i_model = 'chosen-model'
    pipeline.scripts['project'].model_settings.i2i_model = 'different-i2i'
    pipeline.series_store['series'].model_settings.t2i_model = 'chosen-model'
    pipeline.series_store['series'].model_settings.i2i_model = 'different-i2i'
    prompt = '用户改为红衣，举左手。'
    review = pipeline.preview_asset_image_submission(scope, 'hero', 'character', prompt=prompt, generation_type='design:costume',
        references=[reference], image_generation_mode='reference', is_series=scope=='series')
    assert review['positive_prompt'] == prompt
    create = pipeline.create_asset_generation_task if scope=='project' else pipeline.generate_series_asset
    _, task_id = create(scope, 'hero', 'character', prompt=prompt, generation_type='design:costume', references=[reference],
        image_generation_mode='reference', apply_style=False, preserve_prompt=True, expected_review_fingerprint=review['fingerprint'])
    pipeline.process_asset_generation_task(task_id)
    assert pipeline.asset_generation_tasks[task_id]['status'] == 'completed', pipeline.asset_generation_tasks[task_id].get('error')
    assert provider.generate.call_args.args[0] == prompt
    assert provider.generate.call_args.kwargs['model_name'] == review['selected_model_id'] == 'chosen-model'
    assert len(provider.generate.call_args.kwargs['ref_image_paths']) == 1
    pipeline._reference_semantic_prompt.assert_not_called()
