"""Validate one world route shared by simultaneous support intervals."""

import math


def validate_shared_routes(intervals, tolerance_m=1e-4):
    if isinstance(tolerance_m, bool) or not isinstance(tolerance_m, (int, float)) or not math.isfinite(tolerance_m) or tolerance_m < 0:
        raise ValueError('invalid route tolerance')
    if not isinstance(intervals, list) or not intervals:
        raise ValueError('shared route requires intervals')
    routes = {}
    for item in intervals:
        if not isinstance(item, dict) or item.get('side') not in ('l', 'r'):
            raise ValueError('invalid route interval')
        start, end = item.get('startFrame'), item.get('endFrame')
        route = item.get('routeTranslationsM')
        if type(start) is not int or type(end) is not int or start >= end or not isinstance(route, list) or len(route) != end-start+1:
            raise ValueError('invalid route coverage')
        for frame, point in enumerate(route, start):
            if (not isinstance(point, (list, tuple)) or len(point) != 3
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point)):
                raise ValueError('invalid route point')
            routes.setdefault(frame, []).append((item['side'], point))
    conflicts = []
    for frame, points in routes.items():
        if len(points) < 2:
            continue
        reference = points[0][1]
        for side, point in points[1:]:
            delta = math.sqrt(sum((a-b)**2 for a, b in zip(reference, point)))
            if delta > tolerance_m:
                conflicts.append({'frame': frame, 'referenceSide': points[0][0], 'side': side,
                                  'deltaM': delta})
    return {'status': 'diagnostic_only', 'shared': not conflicts,
            'toleranceM': tolerance_m, 'coveredFrames': sorted(routes),
            'conflicts': conflicts}
