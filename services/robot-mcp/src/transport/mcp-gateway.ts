import type {
  GetObservationInput,
  NavigationResult,
  ObjectInspectionResult,
  ObservationResult,
  RobotGateway,
  RobotState,
  RobotToolUnavailable,
  RoomInspectionResult,
  StopResult,
  WorldState,
  KnownLocation,
} from "../contract/types.ts";

// Deliberately no MCP SDK or JSON-RPC implementation is included here.
export class McpRobotGateway implements RobotGateway {
  private unavailable(): RobotToolUnavailable {
    return {
      status: "UNAVAILABLE",
      error_code: "NOT_CONFIGURED",
      message: "MCP transport is not configured in Step 3.",
    } as T & RobotToolUnavailable;
  }

  getState(): RobotState | RobotToolUnavailable {
    return this.unavailable();
  }

  getWorldState(): WorldState | RobotToolUnavailable {
    return this.unavailable();
  }

  getObservation(_input?: GetObservationInput): ObservationResult | RobotToolUnavailable {
    return this.unavailable();
  }

  navigateTo(location: string): NavigationResult {
    return {
      status: "FAILED",
      target: location,
      reason: "UNKNOWN",
      error_code: "UNAVAILABLE",
    };
  }

  inspectRoom(location: string): RoomInspectionResult {
    return {
      status: "FAILED",
      room: location,
      observations: [],
      object_observations: [],
      reason: "UNAVAILABLE",
    };
  }

  inspectObject(objectId: string): ObjectInspectionResult {
    return {
      status: "FAILED",
      object_id: objectId,
      labels: [],
      reason: "UNAVAILABLE",
    };
  }

  stop(): StopResult {
    return { status: "FAILED", reason: "UNAVAILABLE" };
  }

  listKnownLocations(): KnownLocation[] | RobotToolUnavailable {
    return this.unavailable();
  }
}
