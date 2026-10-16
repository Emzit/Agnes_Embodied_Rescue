/** Laser/odometry localization for the indoor office; no camera or world truth input. */
export function withOfficeLocalization(params, start) {
  if (![start?.x,start?.y,start?.yaw].every(Number.isFinite)) throw Error("INVALID_LOCALIZATION_START");
  // The office doorways need earlier heading alignment and cost-based slowing.
  // Keep the original base footprint, collision checks and cruise speed.
  const doorwayController = {lookahead_dist: 0.35, min_lookahead_dist: 0.25,
    max_lookahead_dist: 0.6, rotate_to_heading_min_angle: 0.1,
    use_cost_regulated_linear_velocity_scaling: true};
  for (const [name, value] of Object.entries(doorwayController))
    params = params.replace(new RegExp(`^      ${name}:.*$`, "m"), `      ${name}: ${value}`);
  // Planner endpoint tolerance matches the 18 cm controller goal tolerance.
  params = params.replace(/      tolerance: 0\.05\b/, "      tolerance: 0.15");
  params = params.replace(/node_names: \[[^\]]*\]/, "node_names: [map_server, amcl, planner_server, controller_server, behavior_server, bt_navigator]");
  params = params.replace(/\namcl:\n[\s\S]*$/, "");
  const amcl = `\namcl:
  ros__parameters:
    use_sim_time: true
    base_frame_id: base_link
    odom_frame_id: odom
    global_frame_id: map
    scan_topic: /scan
    tf_broadcast: true
    transform_tolerance: 0.5
    set_initial_pose: true
    initial_pose:
      x: ${Number(start.x || 0).toFixed(8)}
      y: ${Number(start.y || 0).toFixed(8)}
      z: 0.0
      yaw: ${Number(start.yaw || 0).toFixed(8)}
    robot_model_type: nav2_amcl::DifferentialMotionModel
    laser_model_type: likelihood_field_prob
    laser_max_range: 12.0
    laser_min_range: 0.1
    laser_likelihood_max_dist: 2.0
    max_beams: 90
    do_beamskip: true
    beam_skip_distance: 0.2
    beam_skip_threshold: 0.3
    beam_skip_error_threshold: 0.9
    min_particles: 500
    max_particles: 2000
    update_min_d: 0.05
    update_min_a: 0.05
    alpha1: 0.02
    alpha2: 0.02
    alpha3: 0.02
    alpha4: 0.02
    sigma_hit: 0.2
    z_hit: 0.8
    z_rand: 0.2
    recovery_alpha_slow: 0.001
    recovery_alpha_fast: 0.1
`
  return params + amcl;
}
