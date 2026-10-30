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
        action = item.get('action')
        if action is not None and not isinstance(action, str):
            raise ValueError('invalid route action')
        start, end = item.get('startFrame'), item.get('endFrame')
        route = item.get('routeTranslationsM')
        if type(start) is not int or type(end) is not int or start >= end or not isinstance(route, list) or len(route) != end-start+1:
            raise ValueError('invalid route coverage')
        for frame, point in enumerate(route, start):
            if (not isinstance(point, (list, tuple)) or len(point) != 3
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point)):
                raise ValueError('invalid route point')
            routes.setdefault((action, frame), []).append((item['side'], point))
    conflicts = []
    covered_by_action = {}
    for (action, frame), points in routes.items():
        covered_by_action.setdefault(action, []).append(frame)
        if len(points) < 2:
            continue
        reference = points[0][1]
        for side, point in points[1:]:
            delta = math.sqrt(sum((a-b)**2 for a, b in zip(reference, point)))
            if delta > tolerance_m:
                conflicts.append({'action': action, 'frame': frame, 'referenceSide': points[0][0], 'side': side,
                                  'deltaM': delta})
    return {'status': 'diagnostic_only', 'shared': not conflicts,
            'toleranceM': tolerance_m, 'coveredFrames': sorted({frame for _, frame in routes}),
            'coveredFramesByAction': {action: sorted(frames) for action, frames in covered_by_action.items()},
            'conflicts': conflicts}


def validate_route_continuity(intervals, fps, max_speed_mps=4.0):
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise ValueError('invalid route FPS')
    if isinstance(max_speed_mps, bool) or not isinstance(max_speed_mps, (int, float)) or not math.isfinite(max_speed_mps) or max_speed_mps <= 0:
        raise ValueError('invalid route speed limit')
    # Validate before computing: NaN and empty inputs must not pass this gate.
    if not isinstance(intervals, list) or not intervals:
        raise ValueError('shared route requires intervals')
    groups = {}
    for item in intervals:
        if not isinstance(item, dict):
            raise ValueError('invalid route interval')
        action = item.get('action')
        if action is not None and not isinstance(action, str):
            raise ValueError('invalid route action')
        groups.setdefault(action, []).append(item)
    segments, gaps, violations, conflicts = [], [], [], []
    for action, items in groups.items():
        shared = validate_shared_routes(items)
        conflicts.extend(dict(c, action=action) for c in shared['conflicts'])
        routes = {}
        for item in items:
            route = item['routeTranslationsM']
            speeds = [math.dist(a, b)*fps for a, b in zip(route, route[1:])]
            segments.append({'action': action, 'side': item['side'],
                             'startFrame': item['startFrame'], 'endFrame': item['endFrame'],
                             'maxSpeedMps': max(speeds, default=0.0),
                             'speedViolation': max(speeds, default=0.0) > max_speed_mps})
            for frame, point in enumerate(route, item['startFrame']):
                routes.setdefault(frame, []).append(point)
        frames = sorted(routes)
        for left, right in zip(frames, frames[1:]):
            if right-left > 1:
                gaps.append({'action': action, 'fromFrame': left, 'toFrame': right,
                             'gapFrames': right-left-1, 'boundaryChecked': False,
                             'reason': 'missing route samples between intervals'})
                continue
            # Compare all overlapping proposals, so input order cannot hide a jump.
            speed = max(math.dist(a, b)*fps for a in routes[left] for b in routes[right])
            if speed > max_speed_mps:
                violations.append({'action': action, 'fromFrame': left, 'toFrame': right,
                                   'speedMps': speed})
    return {'status': 'diagnostic_only', 'scope': 'annotated_span_per_action',
            'maxSpeedMps': max_speed_mps, 'segments': segments,
            'speedViolations': violations, 'conflicts': conflicts,
            'gaps': gaps, 'continuous': not violations and not gaps and not conflicts}
