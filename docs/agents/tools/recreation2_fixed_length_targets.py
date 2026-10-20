"""Isolated weak-perspective proxy experiment, not a metric pose recovery model."""
import copy
import itertools
import math
import statistics

Y_SCALE = 792 / 1394
PRIOR_SCALE = .05
ACCEL_SCALE = .03


def branch_path(candidates, original_z, times, temporal):
    """Exact second-order DP over four depth-sign branches per two-bone chain."""
    n = len(times)
    assert n >= 3 and all(b > a for a, b in zip(times, times[1:]))
    dt_ref = statistics.median(b - a for a, b in zip(times, times[1:]))
    unary = [[sum(((v - o) / PRIOR_SCALE) ** 2 for v, o in zip(c, z))
              for c in cs] for cs, z in zip(candidates, original_z)]

    def bend(t, a, b, c):
        return sum((((vc - vb) / (times[t] - times[t-1]) -
                      (vb - va) / (times[t-1] - times[t-2])) * dt_ref / ACCEL_SCALE) ** 2
                   for va, vb, vc in zip(candidates[t-2][a], candidates[t-1][b], candidates[t][c]))

    def objective(path):
        return sum(unary[t][k] for t, k in enumerate(path)) + (
            sum(bend(t, *path[t-2:t+1]) for t in range(2, n)) if temporal else 0)

    if not temporal:
        path = [min(range(len(cs)), key=lambda k: unary[t][k]) for t, cs in enumerate(candidates)]
        return path, objective(path)
    costs = {(a, b): unary[0][a] + unary[1][b]
             for a in range(len(candidates[0])) for b in range(len(candidates[1]))}
    back = []
    for t in range(2, n):
        new, pointers = {}, {}
        for b in range(len(candidates[t-1])):
            for c in range(len(candidates[t])):
                a = min(range(len(candidates[t-2])), key=lambda a: costs[a, b] + bend(t, a, b, c))
                new[b, c] = costs[a, b] + unary[t][c] + bend(t, a, b, c)
                pointers[b, c] = a
        costs = new
        back.append(pointers)
    a, b = min(costs, key=costs.get)
    path = [a, b]
    for pointers in reversed(back):
        path.insert(0, pointers[path[0], path[1]])
    assert len(path) == n
    assert abs(objective(path) - min(costs.values())) < 1e-8
    return path, objective(path)


def build_targets(track, anchors):
    selected = {a['source_frame']: a['source_pts_s'] for a in anchors
                if a.get('kind') != 'hold_until_next_pts'}
    frames = [f for f in track['frames'] if f['source_frame'] in selected]
    times = [selected[f['source_frame']] for f in frames]
    original = {f['source_frame']: {k: [v[0], v[1] * Y_SCALE, v[2]]
                                  for k, v in f['semantic_joints'].items()} for f in track['frames']}
    cases = {'original': original, 'fixed_frame': copy.deepcopy(original),
             'fixed_temporal': copy.deepcopy(original)}
    audit = {'lengths': {}, 'chains': {}, 'source_frames': list(selected),
             'prior_scale': PRIOR_SCALE, 'accel_scale': ACCEL_SCALE,
             'assumption': 'Fixed image-width proxy length; weak perspective, no metric truth',
             'times': times}
    for chain in [('shoulder', 'elbow', 'wrist'), ('hip', 'knee', 'ankle')]:
        lengths = []
        for start, end in zip(chain, chain[1:]):
            vectors = [[original[f['source_frame']][f'{s}_{end}'][i] -
                        original[f['source_frame']][f'{s}_{start}'][i] for i in range(3)]
                       for f in frames for s in ('left', 'right')]
            med = statistics.median(math.sqrt(sum(v*v for v in d)) for d in vectors)
            feasible = max(math.hypot(*d[:2]) for d in vectors)
            length = max(med, feasible)
            lengths.append(length)
            audit['lengths'][start + '_' + end] = {'fixed': length, 'pooled_3d_median': med,
                                                   'max_xy': feasible, 'feasibility_clamped': feasible > med}
        for side in ('left', 'right'):
            keys = [f'{side}_{p}' for p in chain]
            candidates, original_z = [], []
            for f in frames:
                j = original[f['source_frame']]
                ds = [math.sqrt(max(0, length**2 - sum((j[b][i]-j[a][i])**2 for i in (0, 1))))
                      for a, b, length in zip(keys, keys[1:], lengths)]
                candidates.append([(j[keys[0]][2] + s*ds[0], j[keys[0]][2] + s*ds[0] + t*ds[1])
                                   for s, t in itertools.product((-1, 1), repeat=2)])
                original_z.append(tuple(j[k][2] for k in keys[1:]))
            chosen = {}
            for label, temporal in [('fixed_frame', False), ('fixed_temporal', True)]:
                path, cost = branch_path(candidates, original_z, times, temporal)
                chosen[label] = path
                for f, cs, k in zip(frames, candidates, path):
                    for key, z in zip(keys[1:], cs[k]):
                        cases[label][f['source_frame']][key][2] = z
                audit['chains'][side + '_' + chain[0] + '_' + label] = {'branches': path, 'objective': cost}
            audit['chains'][side + '_' + chain[0] + '_changed_frames'] = sum(
                a != b for a, b in zip(chosen['fixed_frame'], chosen['fixed_temporal']))
    max_length_error = 0
    for label in ('fixed_frame', 'fixed_temporal'):
        for sf in selected:
            j = cases[label][sf]
            for k in j:
                assert j[k][:2] == original[sf][k][:2]
                if k not in [f'{s}_{p}' for s in ('left', 'right') for p in ('elbow', 'wrist', 'knee', 'ankle')]:
                    assert j[k] == original[sf][k]
            for side in ('left', 'right'):
                for segment, v in audit['lengths'].items():
                    start, end = segment.split('_')
                    err = abs(math.dist(j[f'{side}_{start}'], j[f'{side}_{end}']) - v['fixed'])
                    max_length_error = max(max_length_error, err)
                    assert err < 1e-12
    audit['max_fixed_length_error'] = max_length_error
    audit['xy_and_proximal_z_exact'] = True
    audit['depth_ranges'] = {label: {k: max(js[k][2] for sf, js in data.items() if sf in selected) -
                                      min(js[k][2] for sf, js in data.items() if sf in selected)
                                    for k in original[frames[0]['source_frame']]}
                             for label, data in cases.items()}
    return cases, audit


def self_test():
    # Uneven spacing and competing branches: compare DP with every possible path.
    times = [0, .06, .15, .21, .51]
    cs = [[(t*.01 + a*.04, -t*.03 + b*.05) for a, b in itertools.product((-1, 1), repeat=2)]
          for t in range(5)]
    original = [(.02, -.02), (.01, .03), (.04, .01), (.03, -.07), (.02, -.05)]
    path, cost = branch_path(cs, original, times, True)
    dt_ref = statistics.median(b-a for a, b in zip(times, times[1:]))
    def score(p):
        prior = sum(((cs[t][k][i]-original[t][i])/PRIOR_SCALE)**2
                    for t, k in enumerate(p) for i in (0, 1))
        accel = sum((((cs[t][p[t]][i]-cs[t-1][p[t-1]][i])/(times[t]-times[t-1]) -
                       (cs[t-1][p[t-1]][i]-cs[t-2][p[t-2]][i])/(times[t-1]-times[t-2])) *
                      dt_ref/ACCEL_SCALE)**2 for t in range(2, 5) for i in (0, 1))
        return prior+accel
    best = min(score(p) for p in itertools.product(range(4), repeat=5))
    assert abs(best-cost) < 1e-9
    # Two-segment generated trajectory, including changing camera-depth signs.
    frames = []
    for t in range(5):
        joints = {}
        for side in ('left', 'right'):
            for a, b, c in [('shoulder', 'elbow', 'wrist'), ('hip', 'knee', 'ankle')]:
                joints.update({f'{side}_{a}': [.2, .3, 0], f'{side}_{b}': [.25, .4, (-1)**t*.08],
                               f'{side}_{c}': [.27, .5, .11]})
        frames.append({'source_frame': t+1, 'semantic_joints': joints})
    _, audit = build_targets({'frames': frames}, [{'source_frame': t+1, 'source_pts_s': v} for t, v in enumerate(times)])
    assert audit['max_fixed_length_error'] < 1e-12
    print('FIXED_LENGTH_TARGETS_SELF_TEST_PASS: DP equals exhaustive 1024 paths; two-bone invariants pass')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true', required=True)
    parser.parse_args()
    self_test()
