/** Session-local confirmation from actual sensor tool results, never model-authored memory. */
export function createTargetEvidence(now = () => Date.now()) {
 let confirmed = null;
 const unwrap = value => {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  if (!value || typeof value !== 'object') return null;
  if (value.structured !== undefined) return unwrap(value.structured);
  if (value.structuredContent !== undefined) return unwrap(value.structuredContent);
  if (Array.isArray(value.content)) {
   const text = value.content.find(b => b.type === 'text');
   return text ? unwrap(text.text) : null;
  }
  return value;
 };
 const visit = value => {
  if (!value || typeof value !== 'object' || value.still_uncertain === true) return;
  if (Array.isArray(value)) { value.forEach(visit); return; }
  const e = value.evidence;
  if (value.label === 'person' && Number.isFinite(value.confidence) && value.confidence >= .8 &&
      value.source === 'ros2_camera_perception' && e?.method === 'vlm' && e.provider === 'agnes-ai' &&
      /^[a-f0-9]{64}$/.test(e.frame_sha256 ?? '') && Number.isInteger(e.frame_timestamp?.sec)) {
   confirmed = {id:value.id, confidence:value.confidence, frame_sha256:e.frame_sha256,
    frame_timestamp:e.frame_timestamp, source:value.source, provider:e.provider, observed_at:now()};
  }
  for (const key of ['detections','semantic_objects','evidence','vision_observation','fresh_camera_observation','verification','observation']) visit(value[key]);
 };
 return {
  observe(name, raw) {
   if (!/^mcp_(?:robot_mcp|envdoor)_[^_]+_(?:get_observation|get_world_state|inspect_room|inspect_object|open_door|get_robot_state)$/.test(name)) return;
   const value = unwrap(raw); if (!value) return;
   if (value.inspection?.terminal_known === true && value.inspection.status === 'SUCCEEDED') visit(value.inspection.result);
   if (value.status === 'SUCCEEDED') visit(value);
  },
  confirmation() { return confirmed && now()-confirmed.observed_at <= 120000 ? {...confirmed} : null; },
  clear() { confirmed = null; },
 };
}
