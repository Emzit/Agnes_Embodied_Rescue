import {
  decideSafely,
  type DecisionInput,
  type DecisionResult,
} from "../decision/provider.ts";
import type { RobotClient, RobotToolError } from "../robot/types.ts";
import type {
  ActionRecord,
  MissionResetResult,
  MissionState,
} from "./mission-state.ts";
import { createInitialMissionState } from "./mission-state.ts";
import {
  updateWorldMemory,
  type WorldMemory,
  type WorldMemoryUpdate,
} from "./world-memory.ts";

export type BackendTools = {
  mission_get_state(): MissionState;
  mission_reset(input?: { mission_id?: string; goal?: string }): MissionResetResult;
  world_memory_get(): WorldMemory;
  world_memory_update(update: WorldMemoryUpdate): WorldMemory;
  decision_score_candidates(input: DecisionInput): DecisionResult;
  robot_get_state(): ReturnType<RobotClient["getState"]>;
  robot_navigate_to(location: string): ReturnType<RobotClient["navigateTo"]>;
  robot_inspect_room(location: string): ReturnType<RobotClient["inspectRoom"]>;
  robot_inspect_object(object_id: string): ReturnType<RobotClient["inspectObject"]>;
};

export type BackendOptions = {
  robotClient: RobotClient;
  missionId?: string;
  goal?: string;
  now?: () => string;
};

export type CognitiveBackendTools = {
  mission_get_state(): MissionState;
  mission_reset(input?: { mission_id?: string; goal?: string }): MissionResetResult;
  world_memory_get(): WorldMemory;
  world_memory_update(update: WorldMemoryUpdate): WorldMemory;
  decision_score_candidates(input: DecisionInput): DecisionResult;
};

export type CognitiveBackendOptions = {
  missionId?: string;
  goal?: string;
  now?: () => string;
};

export type ToolRegistration = {
  name: string;
  description: string;
  handler(input?: unknown): unknown;
};

export type ToolRegistrar = (tool: ToolRegistration) => void;

// Framework-neutral registration boundary. It does not import Agnes runtime.
export const registerBackendTools = (
  tools: BackendTools,
  registerTool: ToolRegistrar,
): void => {
  registerTool({
    name: "mission_get_state",
    description: "Read the structured mission state.",
    handler: () => tools.mission_get_state(),
  });
  registerTool({
    name: "mission_reset",
    description: "Reset the in-memory mission state.",
    handler: (input) => tools.mission_reset(input as { mission_id?: string; goal?: string }),
  });
  registerTool({
    name: "world_memory_get",
    description: "Read structured World Memory.",
    handler: () => tools.world_memory_get(),
  });
  registerTool({
    name: "world_memory_update",
    description: "Apply a structured World Memory update.",
    handler: (input) => tools.world_memory_update(input as WorldMemoryUpdate),
  });
  registerTool({
    name: "decision_score_candidates",
    description: "Score candidate actions with the available provider.",
    handler: (input) =>
      tools.decision_score_candidates(input as DecisionInput),
  });
  registerTool({
    name: "robot_get_state",
    description: "Read the abstract robot state.",
    handler: () => tools.robot_get_state(),
  });
  registerTool({
    name: "robot_navigate_to",
    description: "Navigate through the abstract RobotClient.",
    handler: (input) => tools.robot_navigate_to(input as string),
  });
  registerTool({
    name: "robot_inspect_room",
    description: "Inspect a room through the abstract RobotClient.",
    handler: (input) => tools.robot_inspect_room(input as string),
  });
  registerTool({
    name: "robot_inspect_object",
    description: "Inspect an object through the abstract RobotClient.",
    handler: (input) => tools.robot_inspect_object(input as string),
  });
};

export const createCognitiveBackendTools = (
  options: CognitiveBackendOptions = {},
): CognitiveBackendTools => {
  let state = createInitialMissionState(
    options.missionId,
    options.goal,
    options.now?.(),
  );
  const now = options.now ?? (() => new Date().toISOString());

  const updateStateMemory = (update: WorldMemoryUpdate): WorldMemory => {
    const nextMemory = updateWorldMemory(state.world_memory, update);
    state = {
      ...state,
      status: String(update.target_status ?? "").toUpperCase() === "FOUND"
        ? "COMPLETED"
        : state.status,
      world_memory: nextMemory,
      updated_at: now(),
    };
    return nextMemory;
  };

  const resetMission = (input: { mission_id?: string; goal?: string } = {}): MissionResetResult => {
    const requestedMissionId = String(input.mission_id ?? '').trim();
    if (requestedMissionId && requestedMissionId !== state.mission_id) {
      state = createInitialMissionState(requestedMissionId, input.goal ?? options.goal, now());
      return state;
    }
    const complete = state.status === "COMPLETED" ||
      String(state.world_memory.target_status).toUpperCase() === "FOUND";
    if (complete) {
      return {
        ok: false,
        code: "MISSION_ALREADY_COMPLETE",
        message: "The current mission is complete. Reset is only valid when starting a new evaluation or a new mission.",
      };
    }
    state = createInitialMissionState(options.missionId, options.goal, now());
    return state;
  };

  return {
    mission_get_state: () => ({ ...state, world_memory: { ...state.world_memory } }),
    mission_reset: resetMission,
    world_memory_get: () => ({ ...state.world_memory }),
    world_memory_update: updateStateMemory,
    decision_score_candidates: (input) => decideSafely(input),
  };
};

export const createBackendTools = (options: BackendOptions): BackendTools => {
  let state = createInitialMissionState(
    options.missionId,
    options.goal,
    options.now?.(),
  );
  const now = options.now ?? (() => new Date().toISOString());

  const updateStateMemory = (update: WorldMemoryUpdate): WorldMemory => {
    const nextMemory = updateWorldMemory(state.world_memory, update);
    state = {
      ...state,
      status: String(update.target_status ?? "").toUpperCase() === "FOUND"
        ? "COMPLETED"
        : state.status,
      world_memory: nextMemory,
      updated_at: now(),
    };
    return nextMemory;
  };

  const resetMission = (input: { mission_id?: string; goal?: string } = {}): MissionResetResult => {
    const requestedMissionId = String(input.mission_id ?? '').trim();
    if (requestedMissionId && requestedMissionId !== state.mission_id) {
      state = createInitialMissionState(requestedMissionId, input.goal ?? options.goal, now());
      return state;
    }
    const complete = state.status === "COMPLETED" ||
      String(state.world_memory.target_status).toUpperCase() === "FOUND";
    if (complete) {
      return {
        ok: false,
        code: "MISSION_ALREADY_COMPLETE",
        message: "The current mission is complete. Reset is only valid when starting a new evaluation or a new mission.",
      };
    }
    state = createInitialMissionState(options.missionId, options.goal, now());
    return state;
  };

  const recordRobotFailure = (
    action_id: string,
    action_type: string,
    target: string,
    result: {
      status: "FAILED";
      reason?: RobotToolError;
      obstacle_id?: string;
    },
  ): void => {
    const robotState = options.robotClient.getState();
    const from =
      "current_location" in robotState ? robotState.current_location : "unknown";
    const action: ActionRecord = {
      action_id,
      action_type,
      target,
      status: "FAILED",
      reason: result.reason,
    };
    const routeReason =
      result.reason === "PATH_BLOCKED" ||
      result.reason === "UNREACHABLE" ||
      result.reason === "TIMEOUT"
        ? result.reason
        : "UNKNOWN";
    updateStateMemory({
      action,
      blocked_route: {
        from,
        to: target,
        reason: routeReason,
        obstacle_id: result.obstacle_id,
      },
    });
  };

  return {
    mission_get_state: () => ({ ...state, world_memory: { ...state.world_memory } }),
    mission_reset: resetMission,
    world_memory_get: () => ({ ...state.world_memory }),
    world_memory_update: updateStateMemory,
    decision_score_candidates: (input) => decideSafely(input),
    robot_get_state: () => options.robotClient.getState(),
    robot_navigate_to: (location) => {
      const result = options.robotClient.navigateTo(location);
      if (result.status === "FAILED") {
        recordRobotFailure("robot_navigate_to", "navigate_to", location, result);
      } else {
        updateStateMemory({
          robot_location: location,
          action: {
            action_id: "robot_navigate_to",
            action_type: "navigate_to",
            target: location,
            status: "SUCCEEDED",
          },
        });
      }
      return result;
    },
    robot_inspect_room: (location) => {
      const result = options.robotClient.inspectRoom(location);
      updateStateMemory({
        searched_room: location,
        active_perception: true,
        last_observation: `room:${location}`,
      });
      return result;
    },
    robot_inspect_object: (object_id) => {
      const result = options.robotClient.inspectObject(object_id);
      updateStateMemory({
        active_perception: true,
        last_observation: `object:${object_id}`,
        known_object: { object_id, labels: result.labels },
      });
      return result;
    },
  };
};
