export type { RobotGateway } from "../contract/types.ts";
import type { RobotGateway } from "../contract/types.ts";
import type { Ros2RobotGateway } from "./ros2-gateway.ts";

// The async ROS2 implementation shares the existing dispatch method names.
export type RobotGatewayBackend = RobotGateway | Ros2RobotGateway;
