from io import BytesIO
import math
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image
import pytest

from src.apps.photos.faces import (
    CandidateFace, FaceObservation, FaceEngineUnavailable, LocalFaceEngine,
    candidate_groups, MODEL_FILES,
)


def observation(angle=0):
    return FaceObservation((0.1, 0.1, 0.2, 0.3), 0.95,
        (math.cos(angle), math.sin(angle)) + (0.,)*126)


def face(identifier, photo, angle=0):
    return CandidateFace(identifier, photo, observation(angle))


def thumbnail(fmt='WEBP', size=(64, 64)):
    output = BytesIO()
    Image.new('RGB', size, 'red').save(output, fmt)
    return output.getvalue()


def engine(detections=None, feature=None):
    instance = object.__new__(LocalFaceEngine)
    calls = []
    instance.np = np
    instance.detector = SimpleNamespace(setInputSize=lambda value:calls.append(value),
        detect=lambda image:(None, detections))
    instance.recognizer = SimpleNamespace(alignCrop=lambda image, bbox:image,
        feature=lambda image: np.array([feature if feature is not None else [1.]*128]))
    return instance, calls


def test_candidates_do_not_chain_or_auto_merge_faces_in_one_photo():
    # A/B and B/C pass 0.5, but A/C fails. Connected components would mismerge all three.
    faces = [face('a','one',0), face('b','two',0.8), face('c','three',1.6)]
    groups = candidate_groups(faces)
    assert len(groups) == 2 and sorted(map(len,groups)) == [1,2]
    assert candidate_groups(list(reversed(faces))) == groups
    assert candidate_groups([face('a','one'),face('b','one'),face('c','two')]) == [('a','c'),('b',)]
    assert candidate_groups([]) == []
    assert candidate_groups([face('a','one'),face('b','two',math.pi)]) == [('a',),('b',)]


@pytest.mark.parametrize('threshold', [float('nan'),float('inf'),0,-1,1.1])
def test_invalid_threshold_rejected(threshold):
    with pytest.raises(ValueError):
        candidate_groups([], threshold=threshold)


def test_grouping_limits_and_duplicate_ids():
    for faces in ([face('a','x'),face('a','y')], [face('', 'x')],
                  [face(str(i),str(i)) for i in range(21)],
                  [face(str(i),'one') for i in range(21)]):
        with pytest.raises(ValueError):
            candidate_groups(faces)


@pytest.mark.parametrize('feature', [(1.,), (0.,)*128, (float('nan'),)+(0.,)*127])
def test_invalid_features_rejected(feature):
    with pytest.raises(ValueError):
        FaceObservation((0.,0.,0.5,0.5),0.9,feature)


def test_model_files_must_be_present_and_match_hash_before_loading(tmp_path):
    with pytest.raises(FaceEngineUnavailable):
        LocalFaceEngine(Path('relative'))
    with pytest.raises(FaceEngineUnavailable):
        LocalFaceEngine(tmp_path)
    for name, (size, _) in MODEL_FILES.items():
        # Same length but incorrect digest must fail; no model API invoked.
        (tmp_path/name).write_bytes(b'x'*size)
    with pytest.raises(FaceEngineUnavailable, match='checksum'):
        LocalFaceEngine(tmp_path)


def test_empty_detection_is_success_but_bad_inputs_and_overflow_fail():
    model, calls = engine()
    assert model.analyze_thumbnail(thumbnail()) == ()
    assert calls == [(64,64)]
    for invalid in [b'', b'not image', thumbnail('PNG'), thumbnail(size=(1025,1))]:
        with pytest.raises((ValueError, OSError)):
            model.analyze_thumbnail(invalid)
    model, _ = engine(np.zeros((21,15)))
    with pytest.raises(ValueError, match='Too many'):
        model.analyze_thumbnail(thumbnail())


def test_detection_coordinates_are_clipped_and_features_normalized():
    row = [-2.,10.,30.,30.] + [15.]*10 + [0.95]
    model, _ = engine(np.array([row]))
    result, = model.analyze_thumbnail(thumbnail())
    assert result.box == (0.,10/64,28/64,30/64)
    assert sum(v*v for v in result.feature) == pytest.approx(1)
    assert len(result.feature) == 128


@pytest.mark.parametrize('values', [[0.]*128, [float('nan')]*128, [1.]*64])
def test_invalid_model_feature_does_not_become_empty_success(values):
    model, _ = engine(np.array([[1.,1.,20.,20.] + [10.]*10 + [0.95]]), values)
    with pytest.raises(ValueError):
        model.analyze_thumbnail(thumbnail())


def test_exif_bearing_thumbnail_rejected():
    output = BytesIO()
    exif = Image.Exif(); exif[274] = 6
    Image.new('RGB',(20,20),'red').save(output,'WEBP',exif=exif)
    with pytest.raises(ValueError, match='without EXIF'):
        engine()[0].analyze_thumbnail(output.getvalue())
