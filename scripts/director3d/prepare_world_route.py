"""Validate an editable route against an explicit retarget diagnostic report."""

import argparse
import hashlib
import json
from pathlib import Path

from support_contact_metrics import validate_annotations
from world_route import validate_world_route


def prepare(report, payload, annotations=None):
    if not isinstance(report, dict) or report.get('schema') != 'director3d-retarget-diagnostic.v1':
        raise ValueError('expected retarget diagnostic contract')
    ranges = {}
    actions = report.get('actions')
    if not isinstance(actions, list) or not actions:
        raise ValueError('retarget contract requires action ranges')
    for action in actions:
        if not isinstance(action, dict) or not isinstance(action.get('action'), str) or action['action'] in ranges:
            raise ValueError('invalid retarget contract action')
        ranges[action['action']] = action.get('frameRange')
    source, target = report.get('sourceSha256'), report.get('targetSha256')
    result = validate_world_route(payload, source, target, ranges, report.get('evaluationFPS'))
    if annotations is not None:
        intervals = validate_annotations(annotations, source, target, ranges)
        result = validate_world_route(payload, source, target, ranges, report.get('evaluationFPS'), intervals)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retarget-report', type=Path, required=True)
    parser.add_argument('--world-route', type=Path, required=True)
    parser.add_argument('--support-annotations', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # No output is written before all contracts pass validation.
    report = prepare(json.loads(args.retarget_report.read_text()), json.loads(args.world_route.read_text()),
                     json.loads(args.support_annotations.read_text()) if args.support_annotations else None)
    report['inputSha256'] = {name: hashlib.sha256(path.read_bytes()).hexdigest()
                            for name, path in [('retargetReport', args.retarget_report), ('worldRoute', args.world_route),
                                               ('supportAnnotations', args.support_annotations)] if path is not None}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print('Full world route validated; routeApplied=false')


if __name__ == '__main__':
    main()
