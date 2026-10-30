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
    if not samples or isinstance(fps, bool) or not math.isfinite(fps) or fps <= 0:
        raise ValueError('invalid cycle samples or FPS')
    frames = [item.get('frame') for item in samples]
    if any(type(frame) is not int for frame in frames) or frames != list(range(frames[0], frames[-1]+1)):
        raise ValueError('cycle samples must be consecutive')
    weights = [item.get('weight') for item in samples]
    if any(not isinstance(weight, (int, float)) or not math.isfinite(weight) or not 0 <= weight <= 1 for weight in weights):
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
