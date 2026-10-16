"""Pure native Nav2 result preservation; no ROS imports, health probes or motion."""

def nav2_result_details(action_status, error_code=None, error_msg=None, existing_reason=None):
    details = {
        'error_code': error_code,
        'error_msg': error_msg if isinstance(error_msg, str) else None,
    }
    if action_status == 'SUCCEEDED':
        return details
    if action_status == 'CANCELED':
        return {**details, 'reason': 'ROBOT_STOPPED'}
    if action_status == 'ABORTED':
        if existing_reason == 'PATH_BLOCKED':
            return {**details, 'reason': 'PATH_BLOCKED'}
        if error_code in (104, '104'):
            return {**details, 'reason': 'CONTROLLER_PATIENCE_EXCEEDED'}
        specific = isinstance(existing_reason, str) and existing_reason not in (
            '', 'UNKNOWN', 'NAVIGATION_SYSTEM_UNHEALTHY')
        return {**details, 'reason': existing_reason if specific else 'NAVIGATION_ABORTED'}
    if isinstance(existing_reason, str):
        details['reason'] = existing_reason
    return details
