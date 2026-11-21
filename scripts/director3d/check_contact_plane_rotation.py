"""Blender-only replay of rotation requests on saved evaluated contact patches.

This rotates geometry copies, not bones or the scene. Run with Blender -b
--python-exit-code 1 --python <this-file> -- --report <probe.json> --output <json>.
"""

import argparse
import hashlib
import itertools
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bounded_support_ik import fit_contact_plane, summarize_contact_phases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    source = args.report.read_bytes()
    report = json.loads(source)
    results = []
    for action in report['actions']:
        samples = action.get('supportIK', [])
        for side in sorted({s['side'] for s in samples}):
            side_samples = [s for s in samples if s['side'] == side]
            # Repeated support intervals can be separated by swing-frame gaps.
            segments = itertools.groupby(enumerate(side_samples),
                                          key=lambda pair: pair[1]['frame']-pair[0])
            phase_frames = []
            for _, segment in segments:
                phases = summarize_contact_phases([s for _, s in segment], report['evaluationFPS'])
                phase_frames.extend((phase, frame) for phase in ('released', 'ramp', 'fullWeight')
                                    for frame in phases[phase]['planeFrames'])
            for phase, frame in phase_frames:
                request = frame['planeCorrection']
                result = {'action': action['action'], 'side': side, 'phase': phase,
                          'frame': frame['frame'], 'request': request,
                          'originalTiltDeg': (frame['patchPlane']['tiltDeg']
                                              if frame['patchPlane'] is not None else None),
                          'selectedCount': frame['groundPatch']['selectedCount']}
                results.append(result)
                if request['status'] == 'rejected':
                    continue
                a, b = frame['patchPlane']['slopeXY']
                normal = Vector((-a, -b, 1)).normalized()
                rotation = (Quaternion(Vector(request['axisWorld']), math.radians(request['angleDeg']))
                            if request['angleDeg'] else Quaternion())
                error = ((rotation @ normal)-Vector((0, 0, 1))).length
                if not math.isfinite(error) or error > 1e-6:
                    raise ValueError('rotation does not align fitted normal with world +Z')
                points = [Vector(p) for p in frame['groundPatch']['points']]
                pivot = sum(points, Vector())/len(points)
                rotated = [list(pivot+rotation @ (p-pivot)) for p in points]
                result.update({'normalAlignmentError': error,
                               'rotatedPatchPlane': fit_contact_plane(rotated)})
    if not any('normalAlignmentError' in r for r in results):
        raise ValueError('no valid rotation requests to verify')
    output = {'schema': 'director3d-contact-plane-rotation-check.v1',
              'status': 'diagnostic_only', 'geometryCopiesOnly': True,
              'boneRotationApplied': False, 'supportAccepted': False,
              'blenderVersion': bpy.app.version_string,
              'inputSha256': hashlib.sha256(source).hexdigest(),
              'sourceSha256': report['sourceSha256'], 'targetSha256': report['targetSha256'],
              'evaluationFPS': report['evaluationFPS'], 'frames': results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2)+'\n')
    print(json.dumps({'frames': len(results), 'verified': sum('normalAlignmentError' in r for r in results)}))


if __name__ == '__main__':
    main()
