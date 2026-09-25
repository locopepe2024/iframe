"""Reparsing must preserve access to the project and generated assets."""
import json
import tempfile
import time
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

from fastapi import HTTPException
from src.apps.comic_gen.models import Script, Character, Scene, Prop, DirectorProfile, DirectorProfileRevision
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.studio_access import verify_studio_resource_path


class ReparseOwnershipTest(unittest.TestCase):
    def test_source_revisions_are_idempotent_and_preserved_through_reparse(self):
        with tempfile.TemporaryDirectory() as root:
            pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
            original = Script(id="project", title="Project", original_text="old",
                              created_at=1, updated_at=1,
                              owner_user_id="user-a", owner_profile_id="profile-a",
                              director_profile_revisions=[DirectorProfileRevision(
                                  revision=1, content_hash="confirmed", profile=DirectorProfile(),
                                  confirmed_at=1,
                              )])
            parsed = Script(id="parsed", title="Project", original_text="new",
                            created_at=2, updated_at=2)
            pipeline.scripts = {original.id: original}
            pipeline._save_lock = threading.Lock()
            pipeline.series_store = {}
            pipeline.data_file = str(Path(root) / "projects.json")
            pipeline.script_processor = Mock()
            pipeline.script_processor.parse_novel.return_value = parsed
            pipeline._extraction_cache = {}

            pipeline.update_script_text("project", "new")
            self.assertEqual(pipeline.scripts["project"].source_revision, 2)
            pipeline.update_script_text("project", "new")
            self.assertEqual(len(pipeline.scripts["project"].source_revisions), 2)

            result = pipeline.reparse_project("project", "new")
            self.assertEqual(result.source_revision, 2)
            self.assertEqual([item.text for item in result.source_revisions], ["old", "new"])
            self.assertEqual(result.director_profile_revisions[0].content_hash, "confirmed")

    def test_cached_and_fresh_extraction_preserve_owner(self):
        for cached in (False, True):
            with self.subTest(cached=cached), tempfile.TemporaryDirectory() as root:
                pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
                original = Script(id="project", title="Project", original_text="old",
                                  created_at=1, updated_at=1,
                                  owner_user_id="user-a", owner_profile_id="profile-a")
                parsed = Script(id="parsed", title="Project", original_text="new",
                                created_at=2, updated_at=2,
                                characters=[Character(id="character", name="A", description="")],
                                scenes=[Scene(id="scene", name="S", description="")],
                                props=[Prop(id="prop", name="P", description="")])
                pipeline.scripts = {original.id: original}
                pipeline._save_lock = threading.Lock()
                pipeline.series_store = {}
                pipeline.data_file = str(Path(root) / "projects.json")
                pipeline.script_processor = Mock()
                pipeline.script_processor.parse_novel.return_value = parsed
                pipeline._extraction_cache = {original.id: (time.time(), parsed)} if cached else {}

                result = pipeline.reparse_project(original.id, "new")

                self.assertEqual(result.owner_user_id, "user-a")
                self.assertEqual(result.owner_profile_id, "profile-a")
                self.assertEqual(result.id, original.id)
                self.assertEqual(result.created_at, original.created_at)
                for entity in result.characters + result.scenes + result.props:
                    self.assertEqual(entity.owner_user_id, "user-a")
                    self.assertEqual(entity.owner_profile_id, "profile-a")
                verify_studio_resource_path("/projects/project/assets/generate", "profile-a",
                                            pipeline.scripts, {})
                with self.assertRaises(HTTPException) as error:
                    verify_studio_resource_path("/projects/project/assets/generate", "profile-b",
                                                pipeline.scripts, {})
                self.assertEqual(error.exception.status_code, 404)
                saved = json.loads(Path(pipeline.data_file).read_text())
                rows = saved.values() if isinstance(saved, dict) else saved
                persisted = next(row for row in rows if row["id"] == original.id)
                self.assertEqual(persisted["owner_profile_id"], "profile-a")
                self.assertEqual(persisted["owner_user_id"], "user-a")
                self.assertEqual(pipeline.script_processor.parse_novel.call_count, 0 if cached else 1)

    def test_explicit_reviewed_draft_applies_without_cache_or_model_call(self):
        with tempfile.TemporaryDirectory() as root:
            pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
            original = Script(id="project", title="Project", original_text="old",
                              created_at=1, updated_at=1,
                              owner_user_id="user-a", owner_profile_id="profile-a")
            refined = Script(id="draft", title="Project", original_text="new",
                             created_at=2, updated_at=2,
                             characters=[Character(id="temporary", name="主播", description="马来女性")])
            pipeline.scripts = {original.id: original}
            pipeline._save_lock = threading.Lock()
            pipeline.series_store = {}
            pipeline.data_file = str(Path(root) / "projects.json")
            pipeline.script_processor = Mock()
            pipeline.script_processor._create_script_from_data.return_value = refined
            pipeline._extraction_cache = {}
            draft = {
                "characters": [{"name": "主播", "description": "马来女性"}],
                "scenes": [],
                "props": [],
            }

            result = pipeline.reparse_project(original.id, "new", draft)

            pipeline.script_processor._create_script_from_data.assert_called_once_with(
                "Project", "new", draft
            )
            pipeline.script_processor.parse_novel.assert_not_called()
            self.assertEqual(result.characters[0].name, "主播")
            self.assertEqual(result.owner_profile_id, "profile-a")


if __name__ == "__main__":
    unittest.main()
