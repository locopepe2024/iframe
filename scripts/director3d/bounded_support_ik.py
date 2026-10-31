"""Pure two-bone geometry for offline trials; no silent target clamping."""

import math
from support_contact_metrics import vector


def add(a, b):
    return [x+y for x, y in zip(a, b)]


def sub(a, b):
    return [x-y for x, y in zip(a, b)]


def mul(a, scale):
    return [x*scale for x in a]


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def norm(a):
    return math.sqrt(dot(a, a))


def blend_weight(frame, start, end):
    if type(start) is not int or type(end) is not int or end-start < 4:
        raise ValueError('IK interval needs at least five frames')
    t = max(0.0, min(1.0, (frame-start)/2, (end-frame)/2))
    return t*t*(3-2*t)


def solve_leg(hip, knee, ankle, offset, weight):
    hip, knee, ankle, offset = [list(vector(v)) for v in (hip, knee, ankle, offset)]
    if isinstance(weight, bool) or not math.isfinite(weight) or not 0 <= weight <= 1:
        raise ValueError('invalid IK weight')
    if norm(offset) > 0.05:
        raise ValueError('requested support offset exceeds 0.05 m')
    upper, lower = norm(sub(knee, hip)), norm(sub(ankle, knee))
    goal = add(ankle, mul(offset, weight))
    axis = sub(goal, hip); reach = norm(axis)
    if min(upper, lower, reach) < 1e-7 or not abs(upper-lower)+1e-7 < reach < upper+lower-1e-7:
        raise ValueError('unreachable or degenerate IK target')
    axis = mul(axis, 1/reach)
    bend = sub(sub(knee, hip), mul(axis, dot(sub(knee, hip), axis)))
    if norm(bend) < 1e-7:
        raise ValueError('ambiguous knee pole')
    bend = mul(bend, 1/norm(bend))
    along = (upper*upper-lower*lower+reach*reach)/(2*reach)
    height = math.sqrt(max(0, upper*upper-along*along))
    solved_knee = add(add(hip, mul(axis, along)), mul(bend, height))
    return {'knee': solved_knee, 'ankle': goal, 'weight': weight}


def validate_cycle_samples(samples, fps):
    """Check IK diagnostics for interval continuity; never labels contact passed."""
    if not samples or isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise ValueError('invalid cycle samples or FPS')
    frames = [item.get('frame') for item in samples]
    if any(type(frame) is not int for frame in frames) or frames != list(range(frames[0], frames[-1]+1)):
        raise ValueError('cycle samples must be consecutive')
    weights = [item.get('weight') for item in samples]
    if any(isinstance(weight, bool) or not isinstance(weight, (int, float)) or not math.isfinite(weight) or not 0 <= weight <= 1 for weight in weights):
        raise ValueError('invalid cycle weight')
    if weights[0] != 0 or weights[-1] != 0:
        raise ValueError('support interval must release at both endpoints')
    for item in samples:
        for key in ('ankleResidualM', 'kneeResidualM', 'soleAnchorResidualM'):
            value = item.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError('invalid contact residual')
    max_step = max(abs(b-a) for a, b in zip(weights, weights[1:])) if len(weights) > 1 else 0
    return {'status': 'diagnostic_only', 'frameRange': [frames[0], frames[-1]],
            'evaluationFPS': fps, 'maxWeightStep': max_step,
            'entryWeight': weights[0], 'exitWeight': weights[-1],
            'maxJointResidualM': max(max(item.get(key, float('inf')) for key in ('ankleResidualM', 'kneeResidualM')) for item in samples),
            'endpointSoleResidualM': [samples[0]['soleAnchorResidualM'], samples[-1]['soleAnchorResidualM']],
            'supportAccepted': False}


def bounded_refinement_offset(original_ankle, current_ankle, current_point, goal):
    original_ankle, current_ankle, current_point, goal = [list(vector(v)) for v in
                                                       (original_ankle, current_ankle, current_point, goal)]
    offset = sub(goal, current_point)
    if norm(sub(add(current_ankle, offset), original_ankle)) > .05:
        raise ValueError('cumulative support correction exceeds 0.05 m')
    return offset


def summarize_contact_phases(samples, fps):
    if not samples or isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise ValueError('invalid phase samples or FPS')
    groups = {'released': [], 'ramp': [], 'fullWeight': []}
    previous_frame = None
    count = None
    for item in samples:
        frame, weight = item.get('frame'), item.get('weight')
        if (type(frame) is not int or (previous_frame is not None and frame != previous_frame+1)
                or isinstance(weight, bool) or not isinstance(weight, (int, float))
                or not math.isfinite(weight) or not 0 <= weight <= 1):
            raise ValueError('invalid phase frame or weight')
        previous_frame = frame
        vector(item['soleWorldM']); vector(item['anchorWorldM'])
        patch = item['soleRegionWorldM']
        if not isinstance(patch, list) or not patch or (count is not None and len(patch) != count):
            raise ValueError('invalid phase sole region')
        for point in patch:
            vector(point)
        count = len(patch)
        groups['released' if weight == 0 else 'fullWeight' if weight == 1 else 'ramp'].append(item)
    result = {'status': 'diagnostic_only', 'supportAccepted': False}
    for phase, items in groups.items():
        pairs = [(a, b) for a, b in zip(items, items[1:]) if b['frame'] == a['frame']+1]
        result[phase] = {'frames': [s['frame'] for s in items],
            'maxAnchorResidualM': max((math.dist(s['soleWorldM'], s['anchorWorldM']) for s in items), default=None),
            'maxHorizontalDriftM': max((math.dist(s['soleWorldM'][:2], items[0]['soleWorldM'][:2]) for s in items), default=None),
            'maxHorizontalSpeedMps': max((math.dist(a['soleWorldM'][:2], b['soleWorldM'][:2])*fps for a, b in pairs), default=None),
            'maxPatchVertexDriftM': max((math.dist(p[:2], q[:2]) for s in items
                                          for p, q in zip(items[0]['soleRegionWorldM'], s['soleRegionWorldM'])), default=None),
            'minPatchZM': min((p[2] for s in items for p in s['soleRegionWorldM']), default=None),
            'patchPlane': fit_contact_plane(items[0]['soleRegionWorldM']) if items and len(items[0]['soleRegionWorldM']) >= 3 else None,
            'planeCorrection': None,
            'maxPatchVertexSpeedMps': max((math.dist(p[:2], q[:2])*fps for a, b in pairs
                                          for p, q in zip(a['soleRegionWorldM'], b['soleRegionWorldM'])), default=None)}
    for phase, items in groups.items():
        plane = result[phase]['patchPlane']
        if plane is not None:
            try:
                result[phase]['planeCorrection'] = bounded_plane_correction(items[0]['soleRegionWorldM'])
            except ValueError as exc:
                result[phase]['planeCorrection'] = {'status': 'rejected', 'reason': str(exc), 'applied': False}
    return result


def contact_anchor_from_patch(points, ground_z=0.0):
    if not isinstance(points, list) or not points:
        raise ValueError('contact patch requires points')
    for point in points:
        vector(point)
    if isinstance(ground_z, bool) or not isinstance(ground_z, (int, float)) or not math.isfinite(ground_z):
        raise ValueError('invalid contact ground')
    return [sum(point[i] for point in points) / len(points) for i in range(2)] + [ground_z]


def fit_contact_plane(points):
    """Fit z=ax+by+c; return tilt and residuals without accepting contact."""
    if not isinstance(points, list) or len(points) < 3:
        raise ValueError('contact plane requires three points')
    for point in points:
        vector(point)
    sxx = sum(p[0]*p[0] for p in points); sxy = sum(p[0]*p[1] for p in points)
    syy = sum(p[1]*p[1] for p in points); sx = sum(p[0] for p in points); sy = sum(p[1] for p in points)
    sz = sum(p[2] for p in points); sxz = sum(p[0]*p[2] for p in points); syz = sum(p[1]*p[2] for p in points)
    matrix = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, len(points)]]; rhs = [sxz, syz, sz]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda row: abs(matrix[row][col]))
        if abs(matrix[pivot][col]) < 1e-10:
            raise ValueError('contact patch is collinear in XY')
        matrix[col], matrix[pivot] = matrix[pivot], matrix[col]; rhs[col], rhs[pivot] = rhs[pivot], rhs[col]
        scale = matrix[col][col]
        matrix[col] = [v/scale for v in matrix[col]]; rhs[col] /= scale
        for row in range(3):
            if row == col: continue
            factor = matrix[row][col]
            matrix[row] = [a-factor*b for a,b in zip(matrix[row], matrix[col])]
            rhs[row] -= factor*rhs[col]
    a, b, c = rhs
    residuals = [p[2]-(a*p[0]+b*p[1]+c) for p in points]
    tilt = math.degrees(math.atan(math.sqrt(a*a+b*b)))
    return {'status': 'diagnostic_only', 'slopeXY': [a, b], 'interceptZM': c,
            'tiltDeg': tilt, 'maxAbsResidualM': max(abs(v) for v in residuals),
            'rmsResidualM': math.sqrt(sum(v*v for v in residuals)/len(residuals))}


def bounded_plane_correction(points, max_tilt_deg=8.0):
    fit = fit_contact_plane(points)
    if isinstance(max_tilt_deg, bool) or not isinstance(max_tilt_deg, (int, float)) or not math.isfinite(max_tilt_deg) or max_tilt_deg <= 0:
        raise ValueError('invalid contact tilt limit')
    if fit['tiltDeg'] > max_tilt_deg:
        raise ValueError('contact plane tilt exceeds bounded correction')
    a, b = fit['slopeXY']
    length = math.sqrt(a*a+b*b)
    if length < 1e-10:
        axis = [0.0, 0.0, 0.0]
    else:
        axis = [-b/length, a/length, 0.0]
    return {'status': 'diagnostic_only', 'tiltDeg': fit['tiltDeg'],
            'maxTiltDeg': max_tilt_deg, 'axisWorld': axis,
            'angleDeg': -fit['tiltDeg'], 'applied': False,
            'planeResidualM': fit['maxAbsResidualM']}
