"""Diagnostic contact mask: an observed flight frame always releases both feet."""

def contact_weights(state):
    masks = {'left': (1.0, 0.0), 'right': (0.0, 1.0), 'both': (1.0, 1.0),
             'airborne': (0.0, 0.0), 'unknown': (0.0, 0.0)}
    if state not in masks:
        raise ValueError('Unrecognized contact state')
    left, right = masks[state]
    return {'left': left, 'right': right, 'flight_confirmed': state == 'airborne'}


def frame_gate(source_frame, labels):
    # No forward fill: contact at a neighbouring frame is not evidence here.
    return {'source_frame': source_frame, 'state': labels.get(source_frame, 'unknown'),
            **contact_weights(labels.get(source_frame, 'unknown'))}
