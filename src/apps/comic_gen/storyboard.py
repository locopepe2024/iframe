import os
import time
from typing import Dict, Any, List
from .models import StoryboardFrame, Character, Scene, Prop, GenerationStatus, ImageAsset, ImageVariant, image_variant_storage_key
from .prompt_assembly import append_storyboard_character_descriptions
from ...models.image import WanxImageModel
from ..studio_access import studio_uniart_config, studio_nsfw_new_one_config, studio_media_dir
from ...utils.managed_media_root import ManagedMediaRoot
from ...utils import get_logger
from ...utils.oss_utils import is_object_key

logger = get_logger(__name__)

class StoryboardGenerator:
    def __init__(self, config: Dict[str, Any] = None, *, output_root: str = "output"):
        self.config = config or {}
        self.output_root = os.fspath(output_root)
        self.model = WanxImageModel(self.config.get('model', {}))
        self.output_dir = self.config.get('output_dir', os.path.join(self.output_root, 'storyboard'))

    def _output_dir_for(self, frame: StoryboardFrame) -> str:
        if frame.owner_profile_id:
            return studio_media_dir(frame.owner_profile_id, "storyboard", output_root=self.output_root)
        return self.output_dir

    def _reference_path(self, reference: str) -> str:
        if reference.startswith(("output/", "outputs/")):
            return str(ManagedMediaRoot(self.output_root).resolve(reference))
        if reference.startswith(("https://", "http://")) or is_object_key(reference):
            return reference
        path = os.path.join(self.output_root, reference)
        if os.path.exists(path):
            return os.path.abspath(path)
        return os.path.abspath(reference) if os.path.exists(reference) else path

    def _get_model_for(self, model_name: str):
        """Use the same provider routing as asset generation."""
        from ...models.nsfw_new_one import SEEDREAM_IDS, NSFWNewOneImageModel
        if model_name in SEEDREAM_IDS:
            return NSFWNewOneImageModel(studio_nsfw_new_one_config())
        if model_name and model_name.startswith("uniart/"):
            from ...models.uniart import UniArtImageModel
            return UniArtImageModel(studio_uniart_config())
        if model_name and model_name.startswith("gpt-image"):
            from ...models.mulerouter import MuleRouterImageModel
            return MuleRouterImageModel({})
        return self.model

    def generate_storyboard(self, script: Any, characters: List[Character] = None, scenes: List[Scene] = None,
                            output_dir: str = None) -> Any:
        """Generates images for all frames in the storyboard.

        ``characters`` / ``scenes`` accept the resolver-merged lists
        (Episode → Series → Global). When omitted they fall back to the
        script's own local lists, preserving prior behavior."""
        logger.info(f"Generating storyboard for script: {script.title}")
        resolved_characters = characters if characters is not None else script.characters
        resolved_scenes = scenes if scenes is not None else script.scenes
        
        total_frames = len(script.frames)
        for i, frame in enumerate(script.frames):
            logger.info(f"Generating frame {i+1}/{total_frames}: {frame.id}")
            
            # Skip if already completed (unless force regeneration is needed, but for now we skip)
            if frame.status == GenerationStatus.COMPLETED and frame.image_url:
                continue
                
            # Find scene for this frame
            scene = next((s for s in resolved_scenes if s.id == frame.scene_id), None)
            
            self.generate_frame(
                frame, resolved_characters, scene,
                prompt=frame.image_prompt or None, output_dir=output_dir,
            )
            
        return script

    def generate_frame(
        self,
        frame: StoryboardFrame,
        characters: List[Character],
        scene: Scene,
        ref_image_path: str = None,
        ref_image_paths: List[str] = None,
        prompt: str = None,
        batch_size: int = 1,
        size: str = None,
        model_name: str = None,
        negative_prompt: str = None,
        preserve_prompt: bool = False,
        output_dir: str = None,
    ) -> StoryboardFrame:
        """Generates a storyboard frame image."""
        frame.status = GenerationStatus.PROCESSING
        
        # Default size for storyboard (landscape)
        effective_size = size or "1024*576"
        
        # Construct a rich prompt using character and scene details
        char_descriptions = []
        
        # Collect reference image paths from assets
        asset_ref_paths = []
        
        # If frontend provides explicit reference paths, use them directly
        # Otherwise, auto-collect from characters and scene
        use_frontend_refs = (ref_image_paths and len(ref_image_paths) > 0) or ref_image_path
        
        if use_frontend_refs:
            # Use only what frontend provided (already selected by user)
            if ref_image_paths:
                asset_ref_paths.extend(self._reference_path(ref) for ref in ref_image_paths)
            if ref_image_path:
                asset_ref_paths.append(self._reference_path(ref_image_path))
            logger.info(f"[Storyboard] Using {len(asset_ref_paths)} frontend-provided reference images")
        else:
            # Auto-collect from characters and scene (fallback for batch generation)
            for char_id in frame.character_ids:
                char = next((c for c in characters if c.id == char_id), None)
                if char:
                    # Add character reference image - prioritize selected variant from ImageAsset
                    target_url = None
                    source = "none"
                    
                    # Priority 1: Use selected variant from three_view_asset
                    if char.three_view_asset and char.three_view_asset.selected_id:
                        selected_variant = next((v for v in char.three_view_asset.variants if v.id == char.three_view_asset.selected_id), None)
                        if selected_variant:
                            target_url = image_variant_storage_key(selected_variant)
                            source = f"three_view_asset"
                    
                    # Priority 2: Use selected variant from full_body_asset
                    if not target_url and char.full_body_asset and char.full_body_asset.selected_id:
                        selected_variant = next((v for v in char.full_body_asset.variants if v.id == char.full_body_asset.selected_id), None)
                        if selected_variant:
                            target_url = image_variant_storage_key(selected_variant)
                            source = f"full_body_asset"
                    
                    # Priority 3: Use selected variant from headshot_asset
                    if not target_url and char.headshot_asset and char.headshot_asset.selected_id:
                        selected_variant = next((v for v in char.headshot_asset.variants if v.id == char.headshot_asset.selected_id), None)
                        if selected_variant:
                            target_url = image_variant_storage_key(selected_variant)
                            source = f"headshot_asset"
                    
                    # Priority 4: Fallback to legacy fields
                    if not target_url:
                        target_url = char.three_view_image_url or char.full_body_image_url or char.headshot_image_url or char.avatar_url or char.image_url
                        source = "legacy_fields"
                    
                    logger.info(f"[Storyboard] Character '{char.name}' reference: source={source}, url={target_url}")
                    
                    if target_url:
                        if is_object_key(target_url):
                            asset_ref_paths.append(target_url)
                        else:
                            potential_path = self._reference_path(target_url)
                            if os.path.exists(potential_path):
                                asset_ref_paths.append(os.path.abspath(potential_path))
            
            # Add scene reference image
            scene_url = None
            if scene:
                if scene.image_asset and scene.image_asset.selected_id:
                    selected_variant = next((v for v in scene.image_asset.variants if v.id == scene.image_asset.selected_id), None)
                    if selected_variant:
                        scene_url = image_variant_storage_key(selected_variant)
                if not scene_url:
                    scene_url = scene.image_url
                
                if scene_url:
                    if is_object_key(scene_url):
                        asset_ref_paths.append(scene_url)
                    else:
                        potential_path = self._reference_path(scene_url)
                        if os.path.exists(potential_path):
                            asset_ref_paths.append(os.path.abspath(potential_path))
        
        # Collect character descriptions for prompt building
        for char_id in frame.character_ids:
            char = next((c for c in characters if c.id == char_id), None)
            if char:
                char_descriptions.append(f"{char.name} ({char.description})")
        
        char_text = ", ".join(char_descriptions)

        # Remove duplicates
        asset_ref_paths = list(set(asset_ref_paths))
        
        if not prompt:
            prompt = f"Storyboard Frame: {frame.action_description}. "
            if char_text:
                prompt += f"Characters: {char_text}. "
            if scene:
                prompt += f"Location: {scene.name}, {scene.description}. "
                
            prompt += f"Camera: {frame.camera_angle}"
            if frame.camera_movement:
                prompt += f", {frame.camera_movement}"
            prompt += "."
        else:
            # If prompt is provided by user/LLM, ensure character descriptions are still present for I2I consistency
            if not preserve_prompt:
                prompt = append_storyboard_character_descriptions(prompt, frame.character_ids, characters)
        
        # Store the optimized prompt
        frame.image_prompt = prompt
        
        # Initialize rendered_image_asset if not present
        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset(asset_id=frame.id, asset_type="storyboard_frame")

        try:
            import uuid
            
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_filename = f"{frame.id}_{variant_id}.png"
                output_path = os.path.join(output_dir or self._output_dir_for(frame), output_filename)
                
                # Ensure output directory exists
                os.makedirs(os.path.dirname(output_path), exist_ok=True)

                
                # Use I2I if reference images are available
                # Pass collected asset paths to model
                logger.info(f"[Storyboard] Calling model.generate with {len(asset_ref_paths)} reference images using model {model_name or 'default'}")
                self._get_model_for(model_name).generate(
                    prompt,
                    output_path,
                    ref_image_paths=asset_ref_paths,
                    size=effective_size,
                    model_name=model_name,
                    negative_prompt=negative_prompt,
                )
                
                # Store relative path for frontend serving
                rel_path = os.path.relpath(output_path, self.output_root)
                
                # Create Variant
                variant = ImageVariant(
                    id=variant_id,
                    url=rel_path,
                    prompt=prompt,
                    created_at=time.time()
                )
                frame.rendered_image_asset.variants.append(variant)
                
                # Auto-select the latest one
                frame.rendered_image_asset.selected_id = variant_id
            
            # Sync legacy fields
            selected_variant = next((v for v in frame.rendered_image_asset.variants if v.id == frame.rendered_image_asset.selected_id), None)
            if selected_variant:
                frame.rendered_image_url = image_variant_storage_key(selected_variant)
                frame.image_url = image_variant_storage_key(selected_variant)
                
            frame.updated_at = time.time()
            frame.status = GenerationStatus.COMPLETED
            
        except Exception as e:
            logger.error(f"Failed to generate frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            raise
            
        return frame
