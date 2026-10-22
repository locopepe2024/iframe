"""Offline face candidates, never confirmed identity. No network or storage I/O."""

from dataclasses import dataclass, field
import hashlib
from io import BytesIO
import math
from pathlib import Path

from PIL import Image

from .media import MAX_UPLOAD_BYTES

ZOO_REVISION = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
MODEL_FILES = {
    "face_detection_yunet_2023mar.onnx": (232589, "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "face_recognition_sface_2021dec.onnx": (38696353, "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
}
MODEL_VERSION = "yunet-2023mar-sface-2021dec-v1"
MAX_FACES = 20
FEATURE_SIZE = 128
DEFAULT_CANDIDATE_THRESHOLD = 0.5  # Experimental, not calibrated on personal albums.


class FaceEngineUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class FaceObservation:
    # Box is x/y/width/height in the EXIF-oriented thumbnail, normalized to [0,1].
    box: tuple[float, float, float, float]
    score: float
    feature: tuple[float, ...] = field(repr=False)

    def __post_init__(self):
        if (len(self.box) != 4 or any(not math.isfinite(v) for v in self.box)
                or min(self.box) < 0 or self.box[2] <= 0 or self.box[3] <= 0
                or self.box[0] + self.box[2] > 1.000001
                or self.box[1] + self.box[3] > 1.000001
                or not math.isfinite(self.score) or not 0 <= self.score <= 1):
            raise ValueError("Invalid face geometry")
        if len(self.feature) != FEATURE_SIZE or any(not math.isfinite(v) for v in self.feature):
            raise ValueError("Invalid face feature")
        if abs(sum(v*v for v in self.feature) - 1) > 0.0001:
            raise ValueError("Face feature must be unit normalized")


@dataclass(frozen=True)
class CandidateFace:
    face_id: str
    photo_id: str
    observation: FaceObservation


class LocalFaceEngine:
    """One instance per sequential worker; OpenCV models are mutable, not shared."""

    def __init__(self, model_directory: Path):
        directory = Path(model_directory)
        if not directory.is_absolute():
            raise FaceEngineUnavailable("Explicit absolute model directory required")
        for filename, (size, digest) in MODEL_FILES.items():
            try:
                path = directory / filename
                if path.stat().st_size != size or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise FaceEngineUnavailable("Face model checksum mismatch")
            except OSError as exc:
                raise FaceEngineUnavailable("Face model files unavailable") from exc
        try:
            import cv2
            import numpy
            if cv2.__version__ != "4.10.0":
                raise FaceEngineUnavailable("Supported OpenCV 4.10.0 required")
            self.cv = cv2
            self.np = numpy
            self.detector = cv2.FaceDetectorYN.create(
                str(directory / "face_detection_yunet_2023mar.onnx"), "", (320, 320),
                score_threshold=0.9, nms_threshold=0.3, top_k=5000)
            self.recognizer = cv2.FaceRecognizerSF.create(
                str(directory / "face_recognition_sface_2021dec.onnx"), "")
        except (ImportError, AttributeError) as exc:
            raise FaceEngineUnavailable("Optional face engine dependencies unavailable") from exc

    def analyze_thumbnail(self, raw: bytes) -> tuple[FaceObservation, ...]:
        """Accept only the stored, oriented WebP thumbnail, not arbitrary originals."""
        if not raw or len(raw) > MAX_UPLOAD_BYTES:
            raise ValueError("Invalid thumbnail size")
        with Image.open(BytesIO(raw)) as image:
            if (image.format != "WEBP" or getattr(image, "n_frames", 1) != 1
                    or not 1 <= image.width <= 1024 or not 1 <= image.height <= 1024
                    or image.getexif()):
                raise ValueError("Expected oriented WebP thumbnail without EXIF")
            image.load()
            pixels = self.np.asarray(image.convert("RGB"))[:, :, ::-1].copy()
        height, width = pixels.shape[:2]
        self.detector.setInputSize((width, height))
        _, detections = self.detector.detect(pixels)
        if detections is None:
            return ()
        if len(detections) > MAX_FACES:
            raise ValueError("Too many detected faces for one photo")
        output = []
        for face in detections:
            if len(face) != 15 or not self.np.isfinite(face).all():
                raise ValueError("Invalid face detection output")
            x, y, w, h = (float(v) for v in face[:4])
            left, top = max(0., x), max(0., y)
            right, bottom = min(float(width), x+w), min(float(height), y+h)
            if right <= left or bottom <= top:
                raise ValueError("Face detection outside thumbnail")
            aligned = self.recognizer.alignCrop(pixels, face)
            vector = self.recognizer.feature(aligned).flatten()
            norm = float(self.np.linalg.norm(vector))
            if not math.isfinite(norm) or norm <= 0:
                raise ValueError("Invalid face feature norm")
            output.append(FaceObservation(
                box=(left/width, top/height, (right-left)/width, (bottom-top)/height),
                score=float(face[-1]), feature=tuple(float(v) for v in vector/norm)))
        return tuple(sorted(output, key=lambda item: item.box))


def candidate_groups(faces: list[CandidateFace], *, threshold=DEFAULT_CANDIDATE_THRESHOLD) -> list[tuple[str, ...]]:
    """Conservative complete-linkage groups. Input must belong to ONE owner/task/model.

    This pure function does not enforce authorization: its future worker caller
    must fetch/check owner and consent, and fence again before persistence.
    """
    if not math.isfinite(threshold) or not 0 < threshold <= 1 or len(faces) > 400:
        raise ValueError("Invalid candidate limits")
    if (len({f.face_id for f in faces}) != len(faces)
            or any(not f.face_id or not f.photo_id for f in faces)):
        raise ValueError("Invalid face identifiers")
    by_photo = {}
    for face in faces:
        by_photo[face.photo_id] = by_photo.get(face.photo_id, 0) + 1
    if len(by_photo) > 20 or any(count > MAX_FACES for count in by_photo.values()):
        raise ValueError("Candidate batch exceeds limits")
    ordered = sorted(faces, key=lambda face: face.face_id)
    similarities = {}
    for i, a in enumerate(ordered):
        for j in range(i+1, len(ordered)):
            b = ordered[j]
            similarities[i,j] = (-1 if a.photo_id == b.photo_id else
                sum(x*y for x,y in zip(a.observation.feature, b.observation.feature)))
    groups = [(i,) for i in range(len(ordered))]
    while True:
        best = None
        for i, a in enumerate(groups):
            for j in range(i+1, len(groups)):
                score = min(similarities[min(x,y),max(x,y)] for x in a for y in groups[j])
                if score >= threshold and (best is None or score > best[0]):
                    best = (score, i, j)
        if best is None:
            break
        _, i, j = best
        merged = tuple(sorted(groups[i] + groups[j]))
        groups = sorted([group for k, group in enumerate(groups) if k not in (i,j)] + [merged])
    return [tuple(ordered[i].face_id for i in group) for group in groups]
