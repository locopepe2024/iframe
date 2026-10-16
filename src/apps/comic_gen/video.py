import os
from typing import Dict, Any
from .models import StoryboardFrame, GenerationStatus
from ..studio_access import studio_media_dir
from ...models.wanx import WanxModel
from ...utils import get_logger

logger = get_logger(__name__)

class VideoGenerator:
    def __init__(self, config: Dict[str, Any] = None, *, output_root: str = "output"):
        self.config = config or {}
        self.output_root = os.fspath(output_root)
        self.model = WanxModel(self.config.get('model', {}))
        self.output_dir = self.config.get('output_dir', os.path.join(self.output_root, 'video'))

    def generate_i2v(self, image_url: str, prompt: str, duration: int = 5, audio_url: str = None,
                     owner_profile_id: str = None) -> Dict[str, Any]:
        """
        Generate Image-to-Video for motion reference.
        
        Args:
            image_url: Source image URL (can be local path or remote URL)
            prompt: Motion description prompt
            duration: Video duration in seconds (default 5)
            audio_url: Optional audio URL to drive lip-sync
            
        Returns:
            Dict with video_url key containing the generated video URL
        """
        import uuid
        
        logger.info(f"Generating I2V motion reference: prompt={prompt[:50]}..., duration={duration}")
        
        # Handle local file paths
        img_path = None
        if image_url and not image_url.startswith("http"):
            potential_path = os.path.join(self.output_root, image_url)
            if os.path.exists(potential_path):
                img_path = os.path.abspath(potential_path)
            elif os.path.exists(image_url):
                img_path = image_url
        
        try:
            output_filename = f"motion_ref_{uuid.uuid4().hex[:8]}.mp4"
            output_dir = studio_media_dir(owner_profile_id, "video", output_root=self.output_root) if owner_profile_id else self.output_dir
            output_path = os.path.join(output_dir, output_filename)
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            video_path, _ = self.model.generate(
                prompt=prompt,
                output_path=output_path,
                img_path=img_path,
                img_url=image_url if not img_path else None
            )
            
            # Upload to OSS if configured
            video_url = os.path.relpath(output_path, self.output_root)
            try:
                from ...utils.oss_utils import OSSImageUploader
                uploader = OSSImageUploader()
                if uploader.is_configured:
                    object_key = uploader.upload_file(output_path, sub_path="motion_ref", output_root=self.output_root)
                    if object_key:
                        logger.info(f"Uploaded motion ref video to OSS: {object_key}")
                        video_url = object_key
            except Exception as e:
                logger.error(f"Failed to upload motion ref to OSS: {e}")
            
            return {"video_url": video_url}
            
        except Exception as e:
            logger.error(f"Failed to generate I2V motion reference: {e}")
            raise

    def generate_clip(self, frame: StoryboardFrame) -> StoryboardFrame:
        """Generates a video clip from a storyboard frame."""
        if not frame.image_url:
            logger.error(f"Frame {frame.id} has no image URL. Cannot generate video.")
            frame.status = GenerationStatus.FAILED
            return frame
            
        frame.status = GenerationStatus.PROCESSING
        
        # Use the optimized video prompt if available, otherwise fallback to image prompt or description
        prompt = frame.video_prompt or frame.image_prompt or frame.action_description
        
        img_url = frame.image_url
        img_path = None
        
        # Resolve stored keys against the configured root before physical paths.
        if img_url and not img_url.startswith("http"):
            potential_path = os.path.join(self.output_root, img_url)
            if os.path.exists(potential_path):
                img_path = os.path.abspath(potential_path)
            elif os.path.exists(img_url):
                img_path = img_url

        try:
            output_dir = studio_media_dir(frame.owner_profile_id, "video", output_root=self.output_root) if frame.owner_profile_id else self.output_dir
            output_path = os.path.join(output_dir, f"{frame.id}.mp4")
            os.makedirs(output_dir, exist_ok=True)
            
            video_path, _ = self.model.generate(
                prompt=prompt,
                output_path=output_path,
                img_path=img_path, # Pass local path, model will upload
                img_url=img_url if not img_path else None # Pass URL if it's already remote
            )
            
            # Store relative path for frontend serving
            rel_path = os.path.relpath(output_path, self.output_root)
            frame.video_url = rel_path
            frame.status = GenerationStatus.COMPLETED
            
            # Try uploading to OSS if configured - store Object Key (not full URL)
            try:
                from ...utils.oss_utils import OSSImageUploader
                uploader = OSSImageUploader()
                if uploader.is_configured:
                    object_key = uploader.upload_file(output_path, sub_path="video", output_root=self.output_root)
                    if object_key:
                        logger.info(f"Uploaded video for frame {frame.id} to OSS: {object_key}")
                        # Store Object Key (will be converted to signed URL on API response)
                        frame.video_url = object_key
            except Exception as e:
                logger.error(f"Failed to upload video for frame {frame.id} to OSS: {e}")
                # Continue even if OSS upload fails
        except Exception as e:
            logger.error(f"Failed to generate video for frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            
        return frame
