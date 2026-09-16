"""Playground service layer -- orchestrates AI generation by delegating to existing model adapters.

Routes based on model_id to the appropriate adapter (WanxModel, KlingModel,
ViduModel, MuleRouterVideoModel/ImageModel, WanxImageModel).  Mirrors the
routing logic in ``src/apps/comic_gen/pipeline.py:process_video_task()``.
"""

import os
import shutil
import uuid
from urllib.parse import urlsplit
from datetime import datetime, timezone
from typing import Callable, Dict, Optional

from .models import (
    GenerateRequest,
    PlaygroundDraft,
    PlaygroundGeneration,
    PlaygroundMode,
    PlaygroundOutput,
)
from .storage import PlaygroundStorage
from ...utils import get_logger
from ...models.reference_binding import bind_reference_names, media_kind

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Output directories
# ---------------------------------------------------------------------------
class PlaygroundService:
    """High-level service that creates generation records and delegates to
    the correct model adapter for execution."""

    def __init__(
        self,
        storage: PlaygroundStorage,
        provider_config_loader: Optional[Callable[[], Dict[str, str]]] = None,
    ):
        self.storage = storage
        self.provider_config_loader = provider_config_loader
        # Lazy-initialised model instances (cached for the lifetime of the service)
        self._wanx_model = None
        self._wanx_image_model = None
        self._kling_model = None
        self._vidu_model = None
        self._mulerouter_video_model = None
        self._mulerouter_image_model = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_generation(self, request: GenerateRequest) -> PlaygroundGeneration:
        """Create a :class:`PlaygroundGeneration` record with *status=pending*,
        persist it via storage, and return it."""
        input_media = [
            self.storage.resolve_media_reference(value)
            for value in (request.input_media or [])
        ]
        session = self.storage.ensure_session(request.session_id, request.prompt[:32])
        media_names = {}
        for reference, resolved in zip(request.input_media or [], input_media):
            key = urlsplit(reference).path if reference.startswith(("/playground/media/", "/playground/input-media/", "/studio/media/")) else reference
            name = request.media_names.get(key)
            if name:
                media_names[resolved] = name
        draft = PlaygroundDraft(
            media_names=dict(request.media_names),
            mode=request.mode,
            model_id=request.model_id,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            input_media=list(request.input_media or []),
            parameters=request.parameters or {},
            batch_size=request.batch_size or 1,
            parent_generation_id=request.parent_generation_id,
        )
        gen = PlaygroundGeneration(
            media_names=media_names,
            id=str(uuid.uuid4()),
            mode=request.mode,
            model_id=request.model_id,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            input_media=input_media,
            parameters=request.parameters or {},
            batch_size=request.batch_size or 1,
            outputs=[],
            status="pending",
            error=None,
            created_at=datetime.now(timezone.utc).isoformat(),
            session_id=session.id,
            parent_generation_id=request.parent_generation_id,
            owner_user_id=self.storage.owner_user_id,
            owner_profile_id=self.storage.owner_profile_id,
        )
        self.storage.add_generation(gen)
        draft.parent_generation_id = gen.id
        self.storage.save_session_draft(session.id, draft, request.prompt)
        return gen

    def process_generation(self, generation_id: str, *, resume_only: bool = False) -> None:
        """Execute the actual generation.  Intended to run in a background
        thread -- all calls are synchronous (blocking)."""
        gen = self.storage.get_generation(generation_id)
        if gen is None:
            logger.error("Generation %s not found", generation_id)
            return

        # Mark processing
        gen.status = "processing"
        self.storage.update_generation(gen)

        try:
            if not self._uses_owner_scoped_provider(gen.model_id):
                raise RuntimeError(
                    "This legacy provider is disabled in multi-user mode; select a UniArt catalog model"
                )
            mode = gen.mode
            if mode in (PlaygroundMode.T2I, PlaygroundMode.I2I):
                self._process_image_generation(gen)
            elif mode in (PlaygroundMode.T2V, PlaygroundMode.I2V, PlaygroundMode.R2V, PlaygroundMode.F2V, PlaygroundMode.V2V):
                self._process_video_generation(gen, resume_only=resume_only)
            else:
                raise ValueError(f"Unsupported playground mode: {mode}")

            gen.status = "completed"
        except Exception as exc:
            logger.exception("Generation %s failed", generation_id)
            gen.status = "failed"
            gen.error = str(exc)

        self.storage.update_generation(gen)

    def save_to_library(self, generation_id: str, output_id: str, category: str = "general") -> bool:
        """Copy a generated output to ``output/assets/{category}/`` and flag
        :pyattr:`PlaygroundOutput.saved_to_library` = True."""
        gen = self.storage.get_generation(generation_id)
        if gen is None:
            logger.warning("save_to_library: generation %s not found", generation_id)
            return False

        target_output: Optional[PlaygroundOutput] = None
        for out in gen.outputs:
            if out.id == output_id:
                target_output = out
                break
        if target_output is None:
            logger.warning("save_to_library: output %s not found in generation %s", output_id, generation_id)
            return False

        # media_path is stored as e.g. "output/playground/images/t2i_xxx_0.png"
        # Normalise: try as-is first, then strip leading "output/" and re-join
        src_path = target_output.media_path
        if not os.path.isfile(src_path):
            alt = os.path.join("output", target_output.media_path)
            if os.path.isfile(alt):
                src_path = alt
        if not os.path.isfile(src_path):
            logger.error("save_to_library: source file not found: %s", target_output.media_path)
            return False

        dest_dir = os.path.join(self.storage.asset_dir, category)
        os.makedirs(dest_dir, exist_ok=True)

        dest_path = os.path.join(dest_dir, os.path.basename(src_path))
        shutil.copy2(src_path, dest_path)
        logger.info("Saved output %s to library: %s", output_id, dest_path)

        target_output.saved_to_library = True
        self.storage.update_generation(gen)
        return True

    # ------------------------------------------------------------------
    # Image generation (t2i / i2i)
    # ------------------------------------------------------------------

    def _process_image_generation(self, gen: PlaygroundGeneration) -> None:
        image_output_dir = os.path.join(self.storage.output_dir, "images")
        os.makedirs(image_output_dir, exist_ok=True)

        model_lower = gen.model_id.lower()
        failures = []

        for idx in range(gen.batch_size):
            ext = "png"
            out_filename = f"{gen.mode.value}_{gen.id}_{idx}.{ext}"
            out_path = os.path.join(image_output_dir, out_filename)

            try:
                if model_lower.startswith("uniart/") or model_lower.startswith("gpt-image"):
                    self._generate_image_mulerouter(gen, out_path, idx)
                else:
                    self._generate_image_wanx(gen, out_path, idx)

                output_entry = PlaygroundOutput(
                    id=str(uuid.uuid4()),
                    media_path=out_path,
                    media_type="image",
                )
                gen.outputs.append(output_entry)
                self.storage.update_generation(gen)
            except Exception as exc:
                logger.error("Image generation %s batch %d failed: %s", gen.id, idx, exc)
                failures.append(str(exc))

        if failures and not gen.outputs:
            raise RuntimeError(f"All {len(failures)} batch items failed: {failures[0]}")

    def _generate_image_wanx(self, gen: PlaygroundGeneration, out_path: str, _idx: int) -> None:
        """Delegate to :class:`WanxImageModel` (DashScope image generation)."""
        from ...models.image import WanxImageModel

        if self._wanx_image_model is None:
            self._wanx_image_model = WanxImageModel({})

        params = gen.parameters
        kwargs = {
            "model_name": gen.model_id,
            "size": params.get("size", "1280*1280"),
            "n": 1,
            "negative_prompt": gen.negative_prompt,
            "seed": params.get("seed"),
            "prompt_extend": params.get("prompt_extend", True),
            "watermark": params.get("watermark", False),
            "model": gen.model_id,
        }

        # i2i: attach reference images from input_media
        ref_paths = list(gen.input_media) if gen.mode == PlaygroundMode.I2I else []
        if ref_paths:
            kwargs["ref_image_paths"] = ref_paths

        self._wanx_image_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            **kwargs,
        )

    def _generate_image_mulerouter(self, gen: PlaygroundGeneration, out_path: str, _idx: int) -> None:
        """Delegate to :class:`MuleRouterImageModel` (GPT-Image-2)."""
        from ...models.mulerouter import MuleRouterImageModel
        from ...models.uniart import UniArtImageModel

        runtime_config = self._load_provider_config()
        use_uniart = gen.model_id.lower().startswith("uniart/") or bool(runtime_config) or "uniart.fun" in (
            os.getenv("UNIART_BASE_URL") or os.getenv("OPENAI_BASE_URL") or ""
        )
        model = UniArtImageModel(runtime_config) if use_uniart else MuleRouterImageModel({})

        params = gen.parameters
        kwargs = {
            "size": params.get("size", "1k" if use_uniart else "1024x1024"),
            "quality": params.get("quality", "high"),
            "n": 1,
        }

        # i2i: attach reference images
        if use_uniart and params.get("aspect_ratio"):
            kwargs["aspect_ratio"] = params["aspect_ratio"]
        if gen.mode == PlaygroundMode.I2I and gen.input_media:
            if use_uniart and any(media_kind(ref) != "image" for ref in gen.input_media):
                raise ValueError("Image editing accepts image references only")
            kwargs["ref_image_paths"] = list(gen.input_media)

        model.generate(
            prompt=bind_reference_names(gen.prompt, [gen.media_names.get(ref, "") for ref in gen.input_media]) if use_uniart else gen.prompt,
            output_path=out_path,
            model_name=gen.model_id,
            **kwargs,
        )

    # ------------------------------------------------------------------
    # Video generation (t2v / i2v / r2v / v2v)
    # ------------------------------------------------------------------

    def _process_video_generation(self, gen: PlaygroundGeneration, *, resume_only: bool = False) -> None:
        video_output_dir = os.path.join(self.storage.output_dir, "videos")
        os.makedirs(video_output_dir, exist_ok=True)

        model_lower = gen.model_id.lower()
        failures = []

        for idx in range(gen.batch_size):
            out_filename = f"{gen.mode.value}_{gen.id}_{idx}.mp4"
            out_path = os.path.join(video_output_dir, out_filename)

            try:
                if any(output.media_path == out_path for output in gen.outputs):
                    continue
                if resume_only and str(idx) not in gen.provider_tasks:
                    raise RuntimeError("Interrupted before upstream task ID was saved; automatic resubmission is disabled")
                if model_lower.startswith("uniart/") or model_lower.startswith("seedance") or model_lower.startswith("minimax"):
                    self._generate_video_mulerouter(gen, out_path, batch_index=idx)
                elif model_lower.startswith("kling"):
                    self._generate_video_kling(gen, out_path)
                elif model_lower.startswith("vidu") or model_lower.startswith("viduq"):
                    self._generate_video_vidu(gen, out_path)
                elif model_lower.startswith("happyhorse"):
                    self._generate_video_wanx(gen, out_path)
                elif model_lower.startswith("pixverse"):
                    self._generate_video_wanx(gen, out_path)
                else:
                    self._generate_video_wanx(gen, out_path)

                output_entry = PlaygroundOutput(
                    id=str(uuid.uuid4()),
                    media_path=out_path,
                    media_type="video",
                )
                gen.outputs.append(output_entry)
                self.storage.update_generation(gen)
            except Exception as exc:
                logger.error("Video generation %s batch %d failed: %s", gen.id, idx, exc)
                failures.append(str(exc))

        if failures and not gen.outputs:
            raise RuntimeError(f"All {len(failures)} batch items failed: {failures[0]}")

    # -- adapter delegates ------------------------------------------------

    def _generate_video_wanx(self, gen: PlaygroundGeneration, out_path: str) -> None:
        """Delegate to :class:`WanxModel` (DashScope video generation -- wan2.x / happyhorse)."""
        from ...models.wanx import WanxModel

        if self._wanx_model is None:
            self._wanx_model = WanxModel({})

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        kwargs = {
            "model": gen.model_id,
            "duration": params.get("duration", 5),
            "resolution": params.get("resolution", "720P"),
            "seed": params.get("seed"),
            "negative_prompt": gen.negative_prompt,
            "prompt_extend": params.get("prompt_extend", True),
            "watermark": params.get("watermark", False),
            "ratio": params.get("ratio"),
            "audio_url": params.get("audio_url"),
        }

        # r2v: reference images
        if gen.mode == PlaygroundMode.R2V and gen.input_media:
            kwargs["ref_image_urls"] = list(gen.input_media)

        # v2v: video input
        if gen.mode == PlaygroundMode.V2V and gen.input_media:
            kwargs["video_url"] = gen.input_media[0]

        self._wanx_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            img_path=img_path,
            img_url=img_url,
            **kwargs,
        )

    def _generate_video_mulerouter(self, gen: PlaygroundGeneration, out_path: str, *, batch_index: int = 0) -> None:
        """Delegate to :class:`MuleRouterVideoModel` (Seedance 2.0)."""
        from ...models.mulerouter import MuleRouterVideoModel
        from ...models.uniart import UniArtVideoModel

        runtime_config = self._load_provider_config()
        use_uniart = gen.model_id.lower().startswith("uniart/") or bool(runtime_config) or "uniart.fun" in (
            os.getenv("UNIART_BASE_URL") or os.getenv("OPENAI_BASE_URL") or ""
        )
        model = UniArtVideoModel(runtime_config) if use_uniart else MuleRouterVideoModel({})
        saved_task = gen.provider_tasks.get(str(batch_index))
        if use_uniart and saved_task:
            model.generate(prompt=gen.prompt, output_path=out_path, resume_task_id=saved_task)
            return

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        kwargs = {
            "duration": params.get("duration", 5),
            "resolution": params.get("resolution") if use_uniart else params.get("resolution", "1080p"),
            "aspect_ratio": params.get("aspect_ratio", "16:9"),
            "seed": params.get("seed"),
            "watermark": params.get("watermark", False),
        }

        # r2v: reference images
        if gen.mode == PlaygroundMode.R2V and gen.input_media:
            kwargs["generation_mode"] = "r2v"
            kwargs["ref_image_urls"] = list(gen.input_media)

        if use_uniart:
            if not params.get("resolution") and not gen.provider_tasks.get(str(batch_index)):
                raise ValueError("Video resolution is required; refresh the page and select a resolution before retrying")
            def save_task(task_id: str) -> None:
                gen.provider_tasks[str(batch_index)] = task_id
                self.storage.update_generation(gen)

            kwargs["on_task_submitted"] = save_task
            kwargs["resume_task_id"] = gen.provider_tasks.get(str(batch_index))
            kwargs["model"] = gen.model_id
            references = list(gen.input_media)
            if gen.mode in (PlaygroundMode.R2V, PlaygroundMode.V2V):
                grouped = {kind: [ref for ref in references if media_kind(ref) == kind] for kind in ("image", "video", "audio")}
                references = grouped["image"] + grouped["video"] + grouped["audio"]
                kwargs["ref_image_urls"] = grouped["image"]
                kwargs["ref_video_urls"] = grouped["video"]
                kwargs["ref_audio_urls"] = grouped["audio"]
                img_path, img_url = None, None
                if not grouped["image"]:
                    raise ValueError("UniArt reference video mode requires at least one reference image")
            elif gen.mode == PlaygroundMode.I2V:
                if len(references) != 1 or media_kind(references[0]) != "image":
                    raise ValueError("Image-to-video requires exactly one image; use reference mode for multiple materials")
            elif gen.mode == PlaygroundMode.F2V and any(media_kind(ref) != "image" for ref in references):
                raise ValueError("First/last-frame mode requires images")
            kwargs["reference_prompt"] = bind_reference_names(gen.prompt, [gen.media_names.get(ref, "") for ref in references])
            kwargs["generate_audio"] = params.get("audio")
            kwargs["mode"] = {
                PlaygroundMode.T2V: "text2video",
                PlaygroundMode.I2V: "image2video",
                PlaygroundMode.R2V: "reference2video",
                PlaygroundMode.F2V: "frames2video",
                PlaygroundMode.V2V: "reference2video",
            }[gen.mode]
            if gen.mode == PlaygroundMode.T2V:
                img_path, img_url = None, None

        if gen.mode == PlaygroundMode.F2V:
            if len(gen.input_media) != 2:
                raise ValueError("First/last-frame generation requires exactly two images")
            kwargs["generation_mode"] = "first_last_frame"
            kwargs["first_frame"] = gen.input_media[0]
            kwargs["last_frame"] = gen.input_media[1]

        model.generate(
            prompt=kwargs.pop("reference_prompt", gen.prompt),
            output_path=out_path,
            img_url=img_url,
            img_path=img_path,
            **kwargs,
        )

    def _generate_video_kling(self, gen: PlaygroundGeneration, out_path: str) -> None:
        """Delegate to :class:`KlingModel`."""
        from ...models.kling import KlingModel

        if self._kling_model is None:
            self._kling_model = KlingModel({})

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        self._kling_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            img_url=img_url,
            img_path=img_path,
            duration=params.get("duration", 5),
            model=gen.model_id,
            negative_prompt=gen.negative_prompt,
            aspect_ratio=params.get("aspect_ratio", "16:9"),
            mode=params.get("mode", "std"),
            sound=params.get("sound", "off"),
            cfg_scale=params.get("cfg_scale"),
        )

    def _generate_video_vidu(self, gen: PlaygroundGeneration, out_path: str) -> None:
        """Delegate to :class:`ViduModel`."""
        from ...models.vidu import ViduModel

        if self._vidu_model is None:
            self._vidu_model = ViduModel({})

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        self._vidu_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            img_url=img_url,
            img_path=img_path,
            duration=params.get("duration", 5),
            model=gen.model_id,
            resolution=params.get("resolution", "720p"),
            aspect_ratio=params.get("aspect_ratio", "16:9"),
            seed=params.get("seed", 0),
            audio=params.get("audio", True),
            movement_amplitude=params.get("movement_amplitude", "auto"),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _category_to_asset_type(category: Optional[str]) -> str:
        """Map a Playground save category to a global-library asset_type.

        Known categories (``character`` / ``scene`` / ``prop``) pass through;
        everything else -- including the ``"general"`` default, empty string,
        or ``None`` -- falls back to ``"prop"``."""
        normalized = (category or "").strip().lower()
        if normalized in ("character", "scene", "prop"):
            return normalized
        return "prop"

    def _load_provider_config(self) -> Dict[str, str]:
        if not self.provider_config_loader:
            return {}
        return dict(self.provider_config_loader())

    @staticmethod
    def _uses_owner_scoped_provider(model_id: str) -> bool:
        model = model_id.lower()
        if model.startswith(("uniart/", "seedance", "minimax", "gpt-image")):
            return True
        return os.getenv("LUMENX_ALLOW_SHARED_PROVIDER_CREDENTIALS", "false").lower() == "true"

    @staticmethod
    def _resolve_first_input_media(gen: PlaygroundGeneration):
        """Return ``(img_path, img_url)`` for the first entry in
        :pyattr:`input_media`.  Local files are returned as *img_path*;
        remote URLs as *img_url*."""
        if not gen.input_media:
            return None, None

        first = gen.input_media[0]
        if first.startswith(("http://", "https://")):
            return None, first

        # Try as-is, then relative to output/
        if os.path.exists(first):
            return first, None
        candidate = os.path.join("output", first)
        if os.path.exists(candidate):
            return candidate, None

        # Fall back to treating it as a URL-like reference
        return None, first
