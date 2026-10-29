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
