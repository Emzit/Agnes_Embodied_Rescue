import type { ActionRecord } from "./mission-state.ts";

export type BlockedRoute = {
  from: string;
  to: string;
  reason: "PATH_BLOCKED" | "UNREACHABLE" | "TIMEOUT" | "UNKNOWN";
  obstacle_id?: string;
};

export type KnownObject = {
  object_id: string;
  location?: string;
  labels: Array<{ name: string; confidence: number }>;
};

export type Hazard = {
  id: string;
  location: string;
  kind: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
};

export type PlanStep = {
  action_id: string;
  action_type: string;
  target?: string;
};

export type WorldMemory = {
  robot_location: string;
  searched_rooms: string[];
  blocked_routes: BlockedRoute[];
  known_objects: KnownObject[];
  detected_hazards: Hazard[];
  target_status:
    | "unknown"
    | "not_found"
    | "located"
    | "found"
    | "secured"
    | "FOUND";
  action_history: ActionRecord[];
  replans_count: number;
  active_perception_count: number;
  last_observation: string | null;
  current_plan: PlanStep[];
};

export type WorldMemoryUpdate = {
  robot_location?: string;
  searched_room?: string;
  blocked_route?: BlockedRoute;
  known_object?: KnownObject;
  detected_hazard?: Hazard;
  target_status?: WorldMemory["target_status"];
  action?: ActionRecord;
  replan?: boolean;
  active_perception?: boolean;
  last_observation?: string | null;
  current_plan?: PlanStep[];
};

const appendUnique = <T>(items: T[], item: T, same: (a: T, b: T) => boolean) =>
  items.some((existing) => same(existing, item)) ? items : [...items, item];

export const updateWorldMemory = (
  memory: WorldMemory,
  update: WorldMemoryUpdate,
): WorldMemory => ({
  ...memory,
  robot_location: update.robot_location ?? memory.robot_location,
  searched_rooms:
    update.searched_room === undefined
      ? [...memory.searched_rooms]
      : appendUnique(memory.searched_rooms, update.searched_room, (a, b) => a === b),
  blocked_routes:
    update.blocked_route === undefined
      ? [...memory.blocked_routes]
      : appendUnique(
          memory.blocked_routes,
          update.blocked_route,
          (a, b) => a.from === b.from && a.to === b.to,
        ),
  known_objects:
    update.known_object === undefined
      ? [...memory.known_objects]
      : [
          ...memory.known_objects.filter(
            (item) => item.object_id !== update.known_object?.object_id,
          ),
          update.known_object,
        ],
  detected_hazards:
    update.detected_hazard === undefined
      ? [...memory.detected_hazards]
      : appendUnique(memory.detected_hazards, update.detected_hazard, (a, b) => a.id === b.id),
  target_status: update.target_status ?? memory.target_status,
  action_history:
    update.action === undefined ? [...memory.action_history] : [...memory.action_history, update.action],
  replans_count: memory.replans_count + (update.replan ? 1 : 0),
  active_perception_count:
    memory.active_perception_count + (update.active_perception ? 1 : 0),
  last_observation:
    update.last_observation === undefined
      ? memory.last_observation
      : update.last_observation,
  current_plan: update.current_plan ? [...update.current_plan] : [...memory.current_plan],
});
