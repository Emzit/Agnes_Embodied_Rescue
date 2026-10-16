const INSPECTION_AGENT_RESULT_BUDGET_BYTES = 12 * 1024;

type JsonRecord = Record<string, any>;
const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function unwrapInspection(value: unknown, depth = 0): unknown {
  if (depth > 5) return value;
  if (typeof value === "string") {
    try { return unwrapInspection(JSON.parse(value), depth + 1); }
    catch { return value; }
  }
  if (Array.isArray(value)) {
    const text = value.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
    return text ? unwrapInspection(text.text, depth + 1) : value;
  }
  if (!isRecord(value)) return value;
  if (value.structuredContent !== undefined) return unwrapInspection(value.structuredContent, depth + 1);
  if (value.structured !== undefined) return unwrapInspection(value.structured, depth + 1);
  if (Array.isArray(value.content)) {
    const text = value.content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
    if (text) {
      const unwrapped = unwrapInspection(text.text, depth + 1);
      if (isRecord(unwrapped)) return unwrapped;
    }
  }
  return value;
}

function compactMotion(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.samples)) return value;
  const { samples, ...summary } = value;
  const origin = value.control_frame === "odom" ? value.start_odometry : value.start_pose;
  const start = isRecord(origin) ? origin : null;
  let maxXYDeviation = 0;
  let maxAbsYawError = 0;
  for (const sample of samples) {
    if (!isRecord(sample)) continue;
    if (start && Number.isFinite(sample.x) && Number.isFinite(sample.y) &&
        Number.isFinite(start.x) && Number.isFinite(start.y)) {
      maxXYDeviation = Math.max(maxXYDeviation, Math.hypot(sample.x - start.x, sample.y - start.y));
    }
    if (Number.isFinite(sample.yaw_error)) maxAbsYawError = Math.max(maxAbsYawError, Math.abs(sample.yaw_error));
  }
  const point = (sample: unknown) => {
    if (!isRecord(sample)) return null;
    return { at: sample.at, x: sample.x, y: sample.y, yaw: sample.yaw, yaw_error: sample.yaw_error, frame_id: sample.frame_id };
  };
  return {
    ...summary,
    sample_summary: {
      count: samples.length,
      first: point(samples[0]),
      last: point(samples.at(-1)),
      max_xy_deviation_from_start_m: maxXYDeviation,
      max_abs_yaw_error_rad: maxAbsYawError,
    },
  };
}

function compactDetection(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  return {
    id: value.id,
    label: value.label,
    confidence: value.confidence,
    bbox: value.bbox,
    center: value.center,
    source: value.source,
    frame_id: value.frame_id,
    timestamp: value.timestamp,
    location: value.location,
    view_pose: value.view_pose,
    view_bearing: value.view_bearing,
    evidence: {
      method: evidence.method,
      provider: evidence.provider,
      model: evidence.model,
      demo_marker: evidence.demo_marker,
      general_recognition: evidence.general_recognition,
      frame_timestamp: evidence.frame_timestamp,
      frame_sha256: evidence.frame_sha256,
      image_width: evidence.image_width,
      image_height: evidence.image_height,
      confidence_calibrated_probability: evidence.confidence_calibrated_probability,
    },
  };
}

/** Preserve the current camera evidence; history is available in the raw MCP trace. */
function compactWorldState(value: unknown): unknown {
  const world = unwrapInspection(value);
  if (!isRecord(world)) return value;
  const originalBytes = Buffer.byteLength(JSON.stringify(world), "utf8");
  if (originalBytes <= INSPECTION_AGENT_RESULT_BUDGET_BYTES) return world;
  const robot = isRecord(world.robot) ? { ...world.robot } : world.robot;
  if (isRecord(robot?.inspection)) {
    const { result, ...operation } = robot.inspection;
    robot.inspection = { ...operation, result_available: Boolean(result), poll_via: "get_robot_state" };
  }
  const observations = Array.isArray(world.semantic_objects) ? world.semantic_objects : [];
  const compact: JsonRecord = {
    source: world.source, current_location: world.current_location, robot,
    current_observation: world.current_observation,
    sensor_status: world.sensor_status, camera_status: world.camera_status,
    lidar_obstacle_summary: world.lidar_obstacle_summary,
    known_locations: world.known_locations,
    visited_locations: world.visited_locations, inspected_regions: world.inspected_regions,
    blocked_routes: world.blocked_routes, last_pose: world.last_pose,
    last_observation_timestamp: world.last_observation_timestamp,
    semantic_objects: observations.slice(-12).map(compactDetection),
    historical_objects_total: observations.length,
    history_summary_only: true,
    history_note: "Current observation is complete. Cumulative history and complete scans remain in the raw MCP trace; poll get_robot_state for the inspection result.",
    response_compacted: true, response_original_bytes: originalBytes,
  };
  // The map has its own list_known_locations tool and scan history has its
  // own get_robot_state endpoint. Neither may crowd out the actual new frame.
  if (Buffer.byteLength(JSON.stringify(compact), "utf8") > INSPECTION_AGENT_RESULT_BUDGET_BYTES) {
    compact.known_locations = (world.known_locations ?? []).map((l:any) => ({ id:l.id, name:l.name, type:l.type, pose:l.pose }));
    compact.semantic_objects = [];
    compact.history_note += " Historical object bodies omitted for size; static topology via list_known_locations.";
    delete compact.lidar_obstacle_summary;
    delete compact.blocked_routes;
  }
  if (Buffer.byteLength(JSON.stringify(compact), "utf8") > 24 * 1024) {
    // This pathological current frame is too large for safe native delivery.
    // Fail closed rather than silently dropping a current person detection.
    return { ok:false, status:"PARTIAL", code:"WORLD_OBSERVATION_EXCEEDS_DELIVERY_BUDGET",
      current_location:world.current_location, current_observation_available:false,
      frame_timestamp:world.current_observation?.timestamp,
      frame_sha256:world.current_observation?.frame_sha256,
      response_original_bytes:originalBytes,
      message:"Current observation exceeds the native delivery budget; no truncated visual evidence is claimed." };
  }
  return compact;
}

/**
 * Keep inspect_room's complete result in the Robot MCP trace, while sending a
 * bounded, non-truncated equivalent to the Agent. Per-view detections repeat
 * the same observations already present in the top-level detections array.
 */
export function compactRobotToolResult(toolName: string, value: unknown): unknown {
  if (toolName === "get_world_state") return compactWorldState(value);
  if (toolName !== "inspect_room") return value;
  const normalized = unwrapInspection(value);
  if (!isRecord(normalized)) return value;
  const originalBytes = Buffer.byteLength(JSON.stringify(normalized), "utf8");
  if (originalBytes <= INSPECTION_AGENT_RESULT_BUDGET_BYTES) return normalized;

  const compact: JsonRecord = { ...normalized };
  compact.evidence = (Array.isArray(normalized.evidence) ? normalized.evidence : []).map((view: unknown) => {
    if (!isRecord(view)) return view;
    const { detections, ...viewSummary } = view;
    if (isRecord(viewSummary.motion)) viewSummary.motion = compactMotion(viewSummary.motion);
    if (!Array.isArray(detections)) return viewSummary;
    return {
      ...viewSummary,
      detection_count: detections.length,
      detection_ids: detections.map((item: any) => typeof item?.id === "string" ? item.id : null),
    };
  });
  if (Array.isArray(normalized.detections)) compact.detections = normalized.detections.map(compactDetection);

  // A per-view list of hashes and IDs remains available above; this history is
  // a redundant second copy and is not needed to interpret the observations.
  delete compact.confidence_history;
  compact.response_compacted = true;
  compact.response_original_bytes = originalBytes;

  let encoded = JSON.stringify(compact);
  if (Buffer.byteLength(encoded, "utf8") > INSPECTION_AGENT_RESULT_BUDGET_BYTES) {
    compact.detections = (Array.isArray(compact.detections) ? compact.detections : []).map((item: any) => ({
      id: item?.id, label: item?.label, confidence: item?.confidence,
      source: item?.source, frame_id: item?.frame_id, timestamp: item?.timestamp,
      evidence: { method: item?.evidence?.method, provider: item?.evidence?.provider, model: item?.evidence?.model, frame_timestamp: item?.evidence?.frame_timestamp,
        frame_sha256: item?.evidence?.frame_sha256 },
    }));
    encoded = JSON.stringify(compact);
  }
  if (Buffer.byteLength(encoded, "utf8") <= INSPECTION_AGENT_RESULT_BUDGET_BYTES) return compact;

  const detections = Array.isArray(compact.detections) ? compact.detections : [];
  const byLabel = new Map<string, any>();
  const persons: any[] = [];
  for (const item of detections) {
    const label = String(item?.label ?? "unknown");
    if (/person|researcher|人员|研究员/iu.test(label)) persons.push(item);
    const previous = byLabel.get(label);
    if (!previous || Number(item?.confidence ?? 0) > Number(previous?.confidence ?? 0)) byLabel.set(label, item);
  }
  const selected = [...new Map([...byLabel.values(), ...persons].map(item => [item.id ?? `${item.label}:${item.timestamp?.sec}`, item])).values()];
  compact.detections_summary_only = true;
  compact.detections_total = detections.length;
  compact.detections = selected;
  compact.detection_label_counts = [...detections.reduce((counts: Map<string, number>, item: any) => {
    const label = String(item?.label ?? "unknown");
    counts.set(label, (counts.get(label) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())].map(([label, count]) => ({ label, count }));
  encoded = JSON.stringify(compact);
  if (Buffer.byteLength(encoded, "utf8") <= INSPECTION_AGENT_RESULT_BUDGET_BYTES) return compact;

  // Keep the semantic outcome and a bounded set of representative camera
  // observations if a pathological result still exceeds the tool budget.
  // Per-view motion remains summarized, never silently reported as omitted.
  compact.evidence = compact.evidence.map((view: any) => ({
    yaw: view?.yaw, odom_yaw: view?.odom_yaw, timestamp: view?.timestamp, navigation_status: view?.navigation_status,
    frame_sha256: view?.frame_sha256, perception_status: view?.perception_status,
    motion: view?.motion, detection_count: view?.detection_count ?? view?.detections?.length ?? 0,
    detection_ids: Array.isArray(view?.detection_ids) ? view.detection_ids.slice(0, 12) : [],
  }));
  compact.detections = selected.slice(0, 12).map((item: any) => ({
    id: item?.id, label: item?.label, confidence: item?.confidence,
    source: item?.source, frame_id: item?.frame_id, timestamp: item?.timestamp,
    evidence: { method: item?.evidence?.method, provider: item?.evidence?.provider, model: item?.evidence?.model, frame_timestamp: item?.evidence?.frame_timestamp,
      frame_sha256: item?.evidence?.frame_sha256 },
  }));
  encoded = JSON.stringify(compact);
  if (Buffer.byteLength(encoded, "utf8") <= INSPECTION_AGENT_RESULT_BUDGET_BYTES) return compact;

  return {
    status: normalized.status,
    room: normalized.room,
    inspection_id: normalized.inspection_id,
    rotation_complete: normalized.rotation_complete,
    rotation_evidence: normalized.rotation_evidence,
    return_motion: normalized.return_motion,
    inspected: normalized.inspected,
    ok: normalized.ok,
    code: normalized.code,
    error_code: normalized.error_code,
    reason: normalized.reason,
    message: typeof normalized.message === "string" ? normalized.message.slice(0, 500) : undefined,
    scan_views: normalized.scan_views,
    captured_views: normalized.captured_views,
    analyzed_views: normalized.analyzed_views,
    phase: normalized.phase,
    timing: normalized.timing,
    partial: normalized.partial,
    complete_visibility_claimed: normalized.complete_visibility_claimed,
    detections_summary_only: true,
    detections_total: detections.length,
    detection_label_counts: compact.detection_label_counts,
    detections: compact.detections.filter((item: any) => /person|researcher|人员|研究员/iu.test(String(item?.label ?? ""))),
    evidence: compact.evidence.map((view: any) => ({
      yaw: view?.yaw, odom_yaw: view?.odom_yaw, timestamp: view?.timestamp,
      frame_sha256: view?.frame_sha256, perception_status: view?.perception_status,
      motion_status: view?.motion?.status,
      motion_sample_count: view?.motion?.sample_summary?.count ?? 0,
      motion_max_xy_deviation_m: view?.motion?.sample_summary?.max_xy_deviation_from_start_m ?? null,
      detection_count: view?.detection_count ?? 0,
    })),
    response_compacted: true,
    response_original_bytes: originalBytes,
    response_budget_exceeded: true,
  };
}
