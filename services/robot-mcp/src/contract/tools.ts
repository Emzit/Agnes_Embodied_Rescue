import type { RobotToolError } from "./types.ts";

export type RobotToolName =
  | "get_robot_state"
  | "get_world_state"
  | "get_observation"
  | "navigate_to"
  | "inspect_room"
  | "inspect_object"
  | "stop_robot"
  | "list_known_locations";

export type RobotToolContract = {
  tool_name: RobotToolName;
  purpose: string;
  input_type: string;
  output_type: string;
  error_codes: RobotToolError[];
  read_only: boolean;
  has_side_effects: boolean;
  safe_to_retry: boolean;
};

export const ROBOT_TOOL_CONTRACTS: readonly RobotToolContract[] = [
  {
    tool_name: "get_robot_state",
    purpose: "Read the current robot pose and action history.",
    input_type: "{}",
    output_type: "RobotState",
    error_codes: ["UNAVAILABLE", "NOT_CONFIGURED"],
    read_only: true,
    has_side_effects: false,
    safe_to_retry: true,
  },
  {
    tool_name: "get_world_state",
    purpose: "Read the agent-visible map and route state.",
    input_type: "{}",
    output_type: "WorldState",
    error_codes: ["UNAVAILABLE", "NOT_CONFIGURED"],
    read_only: true,
    has_side_effects: false,
    safe_to_retry: true,
  },
  {
    tool_name: "get_observation",
    purpose: "Read passive observations at the current robot location.",
    input_type: "GetObservationInput",
    output_type: "ObservationResult",
    error_codes: ["INVALID_OBJECT", "UNAVAILABLE", "NOT_CONFIGURED"],
    read_only: true,
    has_side_effects: false,
    safe_to_retry: true,
  },
  {
    tool_name: "navigate_to",
    purpose: "Navigate to a known location using the map graph.",
    input_type: "{ location: string }",
    output_type: "NavigationResult",
    error_codes: [
      "PATH_BLOCKED",
      "UNREACHABLE",
      "TIMEOUT",
      "ROBOT_STOPPED",
      "UNKNOWN",
      "UNAVAILABLE",
      "NOT_CONFIGURED",
    ],
    read_only: false,
    has_side_effects: true,
    safe_to_retry: false,
  },
  {
    tool_name: "inspect_room",
    purpose: "Actively inspect the room occupied by the robot.",
    input_type: "{ location: string }",
    output_type: "RoomInspectionResult",
    error_codes: ["NOT_AT_LOCATION", "INVALID_LOCATION", "ROBOT_STOPPED"],
    read_only: false,
    has_side_effects: true,
    safe_to_retry: true,
  },
  {
    tool_name: "inspect_object",
    purpose: "Actively inspect one object to improve perception confidence.",
    input_type: "{ object_id: string }",
    output_type: "ObjectInspectionResult",
    error_codes: ["INVALID_OBJECT", "NOT_AT_LOCATION", "ROBOT_STOPPED"],
    read_only: false,
    has_side_effects: true,
    safe_to_retry: true,
  },
  {
    tool_name: "stop_robot",
    purpose: "Stop the robot and cancel active motion.",
    input_type: "{}",
    output_type: "StopResult",
    error_codes: ["UNKNOWN", "UNAVAILABLE", "NOT_CONFIGURED"],
    read_only: false,
    has_side_effects: true,
    safe_to_retry: true,
  },
  {
    tool_name: "list_known_locations",
    purpose: "List locations known to the robot contract.",
    input_type: "{}",
    output_type: "KnownLocation[]",
    error_codes: ["UNAVAILABLE", "NOT_CONFIGURED"],
    read_only: true,
    has_side_effects: false,
    safe_to_retry: true,
  },
];

export const getRobotToolContracts = (): readonly RobotToolContract[] =>
  ROBOT_TOOL_CONTRACTS;
