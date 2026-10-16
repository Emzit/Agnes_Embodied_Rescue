import type { WorldMemory } from "./world-memory.ts";

export type MissionStatus = "IDLE" | "RUNNING" | "PAUSED" | "COMPLETED";

export type ActionRecord = {
  action_id: string;
  action_type: string;
  status: "STARTED" | "SUCCEEDED" | "FAILED";
  target?: string;
  reason?: string;
};

export type MissionState = {
  mission_id: string;
  status: MissionStatus;
  goal: string;
  world_memory: WorldMemory;
  updated_at: string;
};

export type MissionResetRejected = {
  ok: false;
  code: "MISSION_ALREADY_COMPLETE";
  message: string;
};

export type MissionResetResult = MissionState | MissionResetRejected;

export const createInitialMissionState = (
  mission_id = "mission-local",
  goal = "",
  now = "1970-01-01T00:00:00.000Z",
): MissionState => ({
  mission_id,
  status: "IDLE",
  goal,
  world_memory: {
    robot_location: "unknown",
    searched_rooms: [],
    blocked_routes: [],
    known_objects: [],
    detected_hazards: [],
    target_status: "unknown",
    action_history: [],
    replans_count: 0,
    active_perception_count: 0,
    last_observation: null,
    current_plan: [],
  },
  updated_at: now,
});
