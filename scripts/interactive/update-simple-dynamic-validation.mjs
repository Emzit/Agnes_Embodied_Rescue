import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'artifacts/indoor-rescue-upgrade');
const run = path.join(out, 'simple-dynamic-run-v13');
const read = name => JSON.parse(fs.readFileSync(path.join(run, name), 'utf8'));
const mission = path.join(root, 'artifacts/interactive-live/missions/interactive-1791418800564');
const event = read('imported-physical-event.json');
const before = read('imported-lidar-before.json');
const after = read('imported-lidar-after.json');
const result = JSON.parse(fs.readFileSync(path.join(mission, 'result.json'), 'utf8'));
const paths = fs.readFileSync(path.join(run, 'imported-nav-paths.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const triggerSeq = event.trigger_observation?.path_count ?? null;
const post = triggerSeq === null ? [] : paths.filter(item => item.seq > triggerSeq);
const preRange = (before.ranges || []).filter(Number.isFinite);
const postRange = (after.ranges || []).filter(Number.isFinite);
const value = {
  generated_at: new Date().toISOString(),
  layout_id: 'simple_rescue_imported',
  source_mission: 'interactive-1791418800564',
  mission_status: result.status,
  physical_event: event,
  sensor_evidence: {
    lidar_before_timestamp: before.timestamp,
    lidar_after_timestamp: after.timestamp,
    before_min_range_m: Math.min(...preRange),
    after_min_range_m: Math.min(...postRange),
    source: 'real Gazebo EntityFactory + real /scan',
  },
  plan_1: { path_count_before_event: triggerSeq, source: 'real /plan topic' },
  plan_2: { path_count_after_event: post.length, source: 'real /plan topic' },
  world_model_update: 'not accepted as event-caused update; trace updates describe door/search state, not this dynamic entity',
  invalidation_reason: null,
  real_route_change: false,
  nav2_obstacle_layer_loaded: true,
  agent_notified_directly: event.agent_notified === true,
  pass: false,
  blocker: 'The obstacle layer is loaded and LiDAR changed after a real physical event, but post-event Nav2 paths did not prove a causal alternate route.',
  raw_evidence_dir: 'artifacts/indoor-rescue-upgrade/simple-dynamic-run-v13',
};
fs.writeFileSync(path.join(out, 'imported-dynamic-replan-validation.json'), JSON.stringify(value, null, 2) + '\n');
console.log(JSON.stringify(value));
