import base64

import pytest

from src.models.image import WanxImageModel
from src.models.mulerouter import GPT_IMAGE_API_PATHS, MuleRouterImageModel


PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+"
    "X2VINQAAAABJRU5ErkJggg=="
)


class FakeUploaderConfigured:
    def __init__(self):
        self.is_configured = True

    def sign_url_for_api(self, object_key: str):
        return f"https://oss.example/{object_key}"


class FakeUploaderNoOss:
    def __init__(self):
        self.is_configured = False


class TestImageProviderMediaResolverIntegration:
    def test_wan26_reference_object_key_uses_signed_url_when_oss_configured(self, monkeypatch):
        monkeypatch.setattr("src.models.image.OSSImageUploader", FakeUploaderConfigured)

        model = WanxImageModel({"params": {"i2i_model_name": "wan2.6-image"}})
        resolved = model._resolve_wan26_reference_image("lumenx/temp/ref.png")

        assert resolved == "https://oss.example/lumenx/temp/ref.png"

    def test_wan26_reference_remote_url_pass_through(self, monkeypatch):
        monkeypatch.setattr("src.models.image.OSSImageUploader", FakeUploaderNoOss)

        model = WanxImageModel({"params": {"i2i_model_name": "wan2.6-image"}})
        remote_ref = "https://example.com/ref.png"

        resolved = model._resolve_wan26_reference_image(remote_ref)

        assert resolved == remote_ref

    def test_wan26_reference_local_without_oss_uses_data_uri(self, monkeypatch, tmp_path):
        ref_path = tmp_path / "reference.png"
        ref_path.write_bytes(base64.b64decode(PNG_1X1_BASE64))
        monkeypatch.setattr("src.models.image.OSSImageUploader", FakeUploaderNoOss)

        model = WanxImageModel({"params": {"i2i_model_name": "wan2.6-image"}})
        resolved = model._resolve_wan26_reference_image(str(ref_path))

        assert resolved.startswith("data:image/png;base64,")

    def test_backend_selection_falls_back_to_dashscope_for_unknown_family(
        self, monkeypatch
    ):
        captured = {}

        class FakeResolved:
            value = "https://example.com/future-ref.png"

        def fake_resolve_backend(_):
            raise KeyError("unknown family")

        def fake_resolve_media_input(
            ref, *, model_name, modality, backend, uploader, **kwargs
        ):
            captured["ref"] = ref
            captured["model_name"] = model_name
            captured["modality"] = modality
            captured["backend"] = backend
            return FakeResolved()

        monkeypatch.setattr("src.models.image.resolve_provider_backend", fake_resolve_backend)
        monkeypatch.setattr("src.models.image.resolve_media_input", fake_resolve_media_input)
        monkeypatch.setattr("src.models.image.OSSImageUploader", FakeUploaderNoOss)

        model = WanxImageModel({"params": {"i2i_model_name": "wan2.6-image"}})
        resolved = model._resolve_wan26_reference_image(
            "https://example.com/future-ref.png",
            model_name="future-image-model",
        )

        assert resolved == "https://example.com/future-ref.png"
        assert captured["backend"] == "dashscope"
        assert captured["modality"] == "image"
        assert captured["model_name"] == "future-image-model"


def test_gpt_image_2_uses_edit_route_for_ordered_reference_images(monkeypatch, tmp_path):
    captured = {}

    monkeypatch.setattr("src.models.mulerouter._get_base_url_for_model", lambda _model: "https://router.test")
    monkeypatch.setattr("src.models.mulerouter._resolve_image_input", lambda path: f"resolved:{path}")

    def submit(base_url, api_path, body):
        captured.update(base_url=base_url, api_path=api_path, body=body)
        return "task-1"

    monkeypatch.setattr("src.models.mulerouter._submit_task", submit)
    monkeypatch.setattr("src.models.mulerouter._poll_task", lambda *_args: {"images": ["https://result.test/image.png"]})
    monkeypatch.setattr("src.models.mulerouter._download_file", lambda *_args: None)

    MuleRouterImageModel({})._generate_via_http(
        "Keep the actor and add the watch",
        str(tmp_path / "result.png"),
        image_generation_mode="reference",
        ref_image_paths=["actor.png", "watch.png"],
    )

    assert captured["api_path"] == GPT_IMAGE_API_PATHS["edit"]
    assert captured["body"]["image"] == "resolved:actor.png"
    assert captured["body"]["reference_images"] == ["resolved:watch.png"]
    assert captured["body"]["prompt"] == "Keep the actor and add the watch"


def test_gpt_image_2_explicit_text_mode_does_not_infer_edit_from_images(monkeypatch, tmp_path):
    monkeypatch.setattr("src.models.mulerouter._get_base_url_for_model", lambda _model: "https://router.test")

    with pytest.raises(ValueError, match="text mode"):
        MuleRouterImageModel({})._generate_via_http(
            "Create a portrait",
            str(tmp_path / "result.png"),
            image_generation_mode="text",
            ref_image_paths=["actor.png"],
        )
