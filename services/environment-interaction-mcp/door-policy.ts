/** Door evidence checks shared by the live MCP and focused regression tests. */
export const FULLY_OPEN_ANGLE = 1.45;

export function doorState(door: any, panel: any) {
  const yaw = panel?.yaw_rad;
  const nominal = Number(door.nominal_orientation ?? door.orientation ?? 0);
  if (typeof yaw !== "number" || !Number.isFinite(yaw) || !Number.isFinite(nominal)) return "UNKNOWN";
  const angle = Math.atan2(Math.sin(yaw - nominal), Math.cos(yaw - nominal));
  return Math.abs(angle) >= FULLY_OPEN_ANGLE ? "OPEN" : "CLOSED";
}

export function nearDoor(pose: any, door: any) {
  const target = door.interaction_pose || { x: door.at?.[0], y: door.at?.[1] };
  return [pose?.x, pose?.y, target?.x, target?.y].every(value => typeof value === "number" && Number.isFinite(value))
    && Math.hypot(pose.x - target.x, pose.y - target.y) <= 1.6;
}

export function visibleAgnesDoors(observation: any) {
  if (!observation?.camera?.available) return [];
  return (observation.semantic_objects || []).filter((item: any) => item.label === "door"
    && item.evidence?.method === "vlm" && item.evidence?.provider === "agnes-ai"
    && typeof item.evidence?.frame_sha256 === "string" && /^[a-f0-9]{64}$/i.test(item.evidence.frame_sha256));
}

/** Distinguish a missing sensor/inference from a genuine negative image result. */
export function doorInspectionFailure(observation: any, near: boolean, panelState: string) {
  if (!observation?.camera?.available) return "CAMERA_UNAVAILABLE";
  if (observation.perception_status !== "AVAILABLE") return "DOOR_PERCEPTION_UNAVAILABLE";
  if (!near) return "DOOR_OUT_OF_REACH";
  if (!visibleAgnesDoors(observation).length) return "DOOR_NOT_VISUALLY_OBSERVED";
  if (panelState === "UNKNOWN") return "PANEL_POSE_UNAVAILABLE";
  return null;
}
