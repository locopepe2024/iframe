"""Compare Blender route/unrouted diagnostics; invoke with ordinary Python on media."""

import argparse
import copy
import json
import math
from pathlib import Path
import subprocess


def compare(report_a, report_b, sole_a, sole_b):
    a, b = report_a['actions'][0], report_b['actions'][0]
    assert a['action'] == b['action'] and len(a['samples']) == len(b['samples'])
    residuals = []
    for left, right in zip(a['samples'], b['samples']):
        assert left['frame'] == right['frame']
        delta = right['routeOffsetM']
        for name in left['targetPointsM']:
            expected = [v+d for v, d in zip(left['targetPointsM'][name], delta)]
            residuals.append(math.dist(expected, right['targetPointsM'][name]))
        assert left['sourcePointsM'] == right['sourcePointsM']
    sa, sb = sole_a['actions'][0], sole_b['actions'][0]
    assert sa['vertices'] == sb['vertices']
    for side in ('l', 'r'):
        assert len(sa['samples'][side]) == len(sb['samples'][side])
        for left, right, frame in zip(sa['samples'][side], sb['samples'][side], b['samples']):
            assert left['frame'] == right['frame'] == frame['frame']
            assert len(left['points']) == len(right['points'])
            for p, q in zip(left['points'], right['points']):
                residuals.append(math.dist([v+d for v, d in zip(p, frame['routeOffsetM'])], q))
    assert residuals and all(math.isfinite(v) for v in residuals)
    maximum = max(residuals)
    assert maximum <= 1e-4, maximum
    # Post-translation contact metrics must not add the route again.
    for left, right in zip(a['annotatedSupport'], b['annotatedSupport']):
        for key in ('maxHorizontalDriftM', 'maxHorizontalSpeedMps'):
            assert abs(left['measurement'][key]-right['measurement'][key]) <= 1e-4
    return maximum


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('blender', 'source', 'target', 'mapping', 'route', 'support', 'output-dir'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args()
    folder = args.output_dir; folder.mkdir(parents=True, exist_ok=True)
    route = json.loads(args.route.read_text())
    assert len(route['routes']) == 1, 'regression fixture must select exactly one action'
    action = route['routes'][0]['action']
    support = json.loads(args.support.read_text())
    # One interval lets the legacy virtual-route gate execute without internal gaps.
    one = copy.deepcopy(support); one['intervals'] = one['intervals'][:1]
    one_path = folder / 'single-support.json'; one_path.write_text(json.dumps(one))
    command = [str(args.blender), '-b', '--python-exit-code', '1', '--python',
               str(Path(__file__).with_name('probe_quaternius_retarget.py')), '--',
               '--source', str(args.source), '--target', str(args.target), '--mapping', str(args.mapping),
               '--sole-contact', '--foot-pivot', 'ankle', '--pelvis-translation', '--actions', action]
    results = {}
    for name, extra in [('baseline', []), ('routed', ['--world-route', str(args.route)]),
                        ('virtual-ik', ['--support-annotations', str(one_path), '--support-ik']),
                        ('routed-ik', ['--support-annotations', str(one_path), '--support-ik', '--world-route', str(args.route)]),
                        ('full-ik', ['--support-annotations', str(args.support), '--support-ik', '--world-route', str(args.route)])]:
        report, sole = folder / (name+'.json'), folder / (name+'-sole.json')
        if name == 'full-ik' and args.render:
            extra += ['--sequence-dir', str(folder / 'sequence')]
        with (folder / (name+'.log')).open('w') as log:
            subprocess.run(command+['--output', str(report), '--sole-samples-output', str(sole)]+extra,
                           stdout=log, stderr=subprocess.STDOUT, check=True)
        results[name] = (json.loads(report.read_text()), json.loads(sole.read_text()))
    metrics = {}
    for name, left, right in [('retarget', 'baseline', 'routed'), ('supportIK', 'virtual-ik', 'routed-ik')]:
        a, sa = results[left]; b, sb = results[right]
        metrics[name+'MaxTranslationResidualM'] = compare(a, b, sa, sb)
    full = results['full-ik'][0]
    metrics['blenderVersion'] = full['blenderVersion']
    metrics['supportIKIntervals'] = full['actions'][0]['supportIKIntervals']
    metrics['status'] = 'diagnostic_only'
    (folder / 'comparison.json').write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))


if __name__ == '__main__':
    main()
