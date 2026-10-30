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


def validate_route_continuity(intervals, fps, max_speed_mps=4.0):
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise ValueError('invalid route FPS')
    if isinstance(max_speed_mps, bool) or not isinstance(max_speed_mps, (int, float)) or not math.isfinite(max_speed_mps) or max_speed_mps <= 0:
        raise ValueError('invalid route speed limit')
    segments = []
    for item in intervals:
        route = item.get('routeTranslationsM', [])
        speeds = [math.sqrt(sum((b[i]-a[i])**2 for i in range(3)))*fps for a, b in zip(route, route[1:])]
        segments.append({'side': item['side'], 'startFrame': item['startFrame'], 'endFrame': item['endFrame'],
                         'maxSpeedMps': max(speeds) if speeds else 0.0,
                         'speedViolation': max(speeds, default=0.0) > max_speed_mps})
    gaps = []
    for left in segments:
        for right in segments:
            if left['side'] != right['side'] or right['startFrame'] <= left['endFrame']:
                continue
            if right['startFrame'] - left['endFrame'] <= 1:
                gaps.append({'side': left['side'], 'fromFrame': left['endFrame'], 'toFrame': right['startFrame'],
                             'gapFrames': right['startFrame']-left['endFrame']-1,
                             'boundaryChecked': False,
                             'reason': 'missing route samples between intervals'})
    return {'status': 'diagnostic_only', 'maxSpeedMps': max_speed_mps,
            'segments': segments, 'speedViolations': [s for s in segments if s['speedViolation']],
            'gaps': gaps, 'continuous': not any(s['speedViolation'] for s in segments) and not gaps}
