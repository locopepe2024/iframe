"""Explicit annotation evidence; does not infer support or move a skeleton."""

import math


def vector(value):
    if (not isinstance(value, (list, tuple)) or len(value) != 3
            or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in value)):
        raise ValueError('expected finite XYZ vector')
    return value


def measure_interval(points, route, fps):
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise ValueError('invalid evaluation FPS')
    if len(points) < 2 or len(route) != len(points):
        raise ValueError('interval requires two samples and complete route coverage')
    world = [[p[i]+r[i] for i in range(3)] for p, r in zip(map(vector, points), map(vector, route))]
    anchor = [world[0][0], world[0][1], 0.0]
    drift = [math.hypot(p[0]-anchor[0], p[1]-anchor[1]) for p in world]
    speeds = [math.hypot(b[0]-a[0], b[1]-a[1])*fps for a, b in zip(world, world[1:])]
    return {'status': 'diagnostic_only', 'anchorWorldM': anchor,
            'maxHorizontalDriftM': max(drift), 'maxHorizontalSpeedMps': max(speeds),
            'heightRangeM': [min(p[2] for p in world), max(p[2] for p in world)],
            'requestedAnchorOffsetsM': [[anchor[i]-p[i] for i in range(3)] for p in world],
            'solverApplied': False}


def validate_annotations(payload, source_hash, target_hash, action_ranges):
    if (payload.get('schema') != 'director3d-support-annotations.v1'
            or payload.get('sourceSha256') != source_hash or payload.get('targetSha256') != target_hash):
        raise ValueError('support annotation identity mismatch')
    intervals = payload.get('intervals')
    if not isinstance(intervals, list) or not intervals:
        raise ValueError('support annotations require intervals')
    seen = {}
    for item in intervals:
        if not isinstance(item, dict):
            raise ValueError('invalid support interval')
        action, side = item.get('action'), item.get('side')
        if not isinstance(action, str) or action not in action_ranges or side not in ('l', 'r'):
            raise ValueError('unknown support action/side')
        start, end = item.get('startFrame'), item.get('endFrame')
        low, high = action_ranges[action]
        if (type(start) is not int or type(end) is not int or not low <= start < end <= high):
            raise ValueError('invalid support interval range')
        if (item.get('provenance') not in ('design_hypothesis', 'manual_review')
                or not isinstance(item.get('evidence'), str) or not item['evidence'].strip()
                or not isinstance(item.get('mesh'), str) or not item['mesh']
                or type(item.get('vertexIndex')) is not int or item['vertexIndex'] < 0):
            raise ValueError('missing support provenance or vertex identity')
        route = item.get('routeTranslationsM')
        if not isinstance(route, list) or len(route) != end-start+1:
            raise ValueError('incomplete support route')
        for point in route:
            vector(point)
        key = (action, side)
        if any(start <= b and end >= a for a, b in seen.get(key, [])):
            raise ValueError('overlapping same-side support intervals')
        seen.setdefault(key, []).append((start, end))
    return intervals
