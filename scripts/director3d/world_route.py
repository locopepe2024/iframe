"""Complete editable world-route contract; no skeleton mutation or interpolation."""

import copy
import math
import re

from shared_route_metrics import validate_route_continuity, validate_shared_routes
from support_contact_metrics import vector


def validate_world_route(payload, source_hash, target_hash, action_ranges, fps,
                         support_intervals=None, max_speed_mps=4.0):
    if not isinstance(payload, dict) or payload.get('schema') != 'director3d-world-route.v1':
        raise ValueError('invalid world route schema')
    for key, expected in [('sourceSha256', source_hash), ('targetSha256', target_hash)]:
        if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected) or payload.get(key) != expected:
            raise ValueError('world route identity mismatch')
    supplied_fps = payload.get('evaluationFPS')
    for value in (fps, supplied_fps):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError('invalid world route evaluation FPS')
    if supplied_fps != fps:
        raise ValueError('world route evaluation FPS mismatch')
    if (payload.get('provenance') not in ('design_hypothesis', 'manual_review')
            or not isinstance(payload.get('evidence'), str) or not payload['evidence'].strip()):
        raise ValueError('world route requires provenance and evidence')
    routes = payload.get('routes')
    if not isinstance(routes, list) or not routes or not isinstance(action_ranges, dict) or not action_ranges:
        raise ValueError('world route requires selected actions')
    by_action, checks = {}, []
    for route in routes:
        if not isinstance(route, dict):
            raise ValueError('invalid world route action')
        action = route.get('action')
        if not isinstance(action, str) or action not in action_ranges or action in by_action:
            raise ValueError('unknown or duplicate world route action')
        bounds = action_ranges[action]
        if (not isinstance(bounds, (list, tuple)) or len(bounds) != 2
                or any(type(v) is not int for v in bounds) or bounds[0] >= bounds[1]):
            raise ValueError('invalid world route action range')
        start, end = route.get('startFrame'), route.get('endFrame')
        if type(start) is not int or type(end) is not int or (start, end) != tuple(bounds):
            raise ValueError('world route must cover full action range')
        points = route.get('translationsM')
        candidate = dict(action=action, side='l', startFrame=start, endFrame=end, routeTranslationsM=points)
        continuity = validate_route_continuity([candidate], fps, max_speed_mps)
        if not continuity['continuous']:
            raise ValueError('world route exceeds speed limit')
        checks.append({'action': action, 'startFrame': start, 'endFrame': end,
                       'maxSpeedMps': continuity['segments'][0]['maxSpeedMps']})
        by_action[action] = route
    if set(by_action) != set(action_ranges):
        raise ValueError('world route missing selected actions')
    resolved = []
    if support_intervals is not None:
        validate_shared_routes(support_intervals)
        for item in support_intervals:
            action = item.get('action')
            if not isinstance(action, str) or action not in by_action:
                raise ValueError('unknown support action')
            route = by_action[action]
            start, end = item['startFrame'], item['endFrame']
            if not route['startFrame'] <= start < end <= route['endFrame']:
                raise ValueError('support interval outside world route')
            points = route['translationsM'][start-route['startFrame']:end-route['startFrame']+1]
            if any(math.dist(vector(a), vector(b)) > 1e-4 for a, b in zip(points, item['routeTranslationsM'])):
                raise ValueError('support route conflicts with canonical world route')
            resolved.append(dict(copy.deepcopy(item), routeTranslationsM=copy.deepcopy(points)))
    return {'schema': 'director3d-world-route-validation.v1', 'status': 'diagnostic_only',
            'routeApplied': False, 'evaluationFPS': fps, 'maxSpeedMps': max_speed_mps,
            'sourceSha256': source_hash, 'targetSha256': target_hash,
            'provenance': payload['provenance'], 'evidence': payload['evidence'],
            'actions': checks, 'routes': copy.deepcopy(routes), 'supportIntervals': resolved}
