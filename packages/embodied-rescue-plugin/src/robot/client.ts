// The plugin consumes the service contract. It does not import MockRobot,
// ROS2, Gazebo, or an MCP transport implementation.
import type {
  InspectionResult,
  NavigationResult,
  ObjectInspectionResult,
  ObservationResult,
  RobotGateway,
  RobotToolError,
  RobotState,
  RoomInspectionResult,
  WorldState,
} from "../../../../services/robot-mcp/src/contract/types.ts";

export type RobotClient = RobotGateway;
export type {
  InspectionResult,
  NavigationResult,
  ObjectInspectionResult,
  ObservationResult,
  RobotState,
  RobotToolError,
  RoomInspectionResult,
  WorldState,
};
export type { RobotGateway } from "../../../../services/robot-mcp/src/contract/types.ts";
