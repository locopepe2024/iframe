"""Pure conversion and coverage rules for confirmed-plan storyboards."""

def validate_plan_coverage(shots, frames):
    expected = [shot['shot_id'] for shot in shots]
    actual = [frame.get('shot_id') for frame in frames]
    positions = {value: index for index, value in enumerate(expected)}
    if any(value not in positions for value in actual):
        raise ValueError('计划分镜包含缺失或未知的 shot_id，请重新生成或修订。')
    missing = set(expected) - set(actual)
    if missing:
        raise ValueError('计划镜头未完整覆盖：' + ', '.join(sorted(missing)))
    for shot in shots:
        if not shot.get('duration_seconds'):
            continue
        durations = [frame.get('duration') for frame in frames if frame.get('shot_id') == shot['shot_id']]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0 for value in durations) or abs(sum(durations) - shot['duration_seconds']) > 0.01:
            raise ValueError('拆帧时长之和必须等于计划镜头时长：' + shot['shot_id'])
    order = [positions[value] for value in actual]
    if order != sorted(order):
        raise ValueError('计划分镜镜头顺序已变化，请保留导演计划顺序。')


def materialize_plan(context, entities):
    scenes = {item['scene_id']: item for item in context['scenes']}
    characters = {item['id']: item['name'] for item in entities['characters']}
    props = {item['id']: item['name'] for item in entities['props']}
    result = []
    for shot in context['shots']:
        scene = scenes[shot['scene_id']]
        dialogue = shot.get('dialogue', [])
        result.append({
            'shot_id': shot['shot_id'],
            'scene_ref_name': scene.get('scene_ref') or scene.get('location', ''),
            'character_ref_names': [characters[key] for key in shot['character_ids'] if key in characters],
            'prop_ref_names': [props[key] for key in shot['prop_ids'] if key in props],
            # Crowd placement is already structured and pinned by the
            # confirmed shooting plan; carry it into the Storyboard draft
            # without asking the model to recreate identities or positions.
            'crowd_instances': [dict(item) for item in shot.get('crowd_instances', [])],
            'action_summary': shot.get('visual_intent', ''),
            'character_acting': shot.get('performance_action', ''),
            'key_action_physics': shot.get('action_physics', ''),
            'visual_atmosphere': scene.get('atmosphere', ''),
            'duration': shot.get('duration_seconds'),
            'dialogue': '\n'.join(f"{line.get('speaker', '')}：{line.get('line', '')}" for line in dialogue) or None,
            **{key: shot.get(key) for key in ('shot_size', 'camera_angle', 'composition', 'camera_movement')},
        })
    if not result or len(result) > 200:
        raise ValueError('导演计划需包含 1–200 个镜头。')
    validate_plan_coverage(context['shots'], result)
    return result
