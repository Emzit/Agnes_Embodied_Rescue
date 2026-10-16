import type {
  GetObservationInput,
  NavigationResult,
  ObjectInspectionResult,
  ObservationResult,
  RobotGateway,
  RobotState,
  RobotToolError,
  RoomInspectionResult,
  StopResult,
  WorldState,
  KnownLocation,
} from "../contract/types.ts";
import { OBJECT_17_ID } from "./observations.ts";
import { MockWorld } from "./world.ts";

export class MockRobot implements RobotGateway {
  private readonly world: MockWorld;
  private current_location: string;
  private stopped = false;
  private last_action: string | null = null;
  private navigation_history: string[] = [];
  private observation_history: string[] = [];

  constructor(world: MockWorld, initialLocation = "Start") {
    this.world = world;
    this.current_location = initialLocation;
  }

  getState(): RobotState {
    return {
      current_location: this.current_location,
      pose: { location: this.current_location },
      stopped: this.stopped,
      last_action: this.last_action,
      navigation_history: [...this.navigation_history],
      observation_history: [...this.observation_history],
      battery_percent: 100,
    };
  }

  getWorldState(): WorldState {
    return this.world.getWorldState();
  }

  getObservation(input?: GetObservationInput): ObservationResult {
    if (this.stopped) {
      return this.failedObservation("ROBOT_STOPPED");
    }
    const result = this.world.getObservation(this.current_location, input?.object_id);
    this.last_action = "get_observation";
    this.observation_history.push(
      `passive:${input?.object_id ?? this.current_location}`,
    );
    return result;
  }

  navigateTo(location: string): NavigationResult {
    this.last_action = `navigate_to:${location}`;
    if (this.stopped) {
      return { status: "FAILED", target: location, reason: "ROBOT_STOPPED" };
    }
    const path = this.world.findPath(this.current_location, location);
    if (path === null) {
      return { status: "FAILED", target: location, reason: "UNREACHABLE" };
    }
    const blocked = this.world.getBlockedRoute(path);
    if (blocked) {
      return {
        status: "FAILED",
        target: location,
        reason: "PATH_BLOCKED",
        blocked_route: blocked.blocked_route,
        obstacle_id: blocked.obstacle_id,
      };
    }
    this.current_location = location;
    this.navigation_history.push(location);
    return { status: "SUCCEEDED", target: location };
  }

  inspectRoom(location: string): RoomInspectionResult {
    if (this.stopped) {
      return {
        status: "FAILED",
        room: location,
        observations: [],
        object_observations: [],
        reason: "ROBOT_STOPPED",
      };
    }
    if (location !== this.current_location) {
      return {
        status: "FAILED",
        room: location,
        observations: [],
        object_observations: [],
        reason: "NOT_AT_LOCATION",
      };
    }
    const result = this.world.inspectRoom(location);
    this.world.afterRoomInspection(location);
    this.last_action = `inspect_room:${location}`;
    this.observation_history.push(`room:${location}`);
    return result;
  }

  inspectObject(objectId: string): ObjectInspectionResult {
    if (this.stopped) {
      return { status: "FAILED", object_id: objectId, labels: [], reason: "ROBOT_STOPPED" };
    }
    if (objectId !== OBJECT_17_ID) {
      return { status: "FAILED", object_id: objectId, labels: [], reason: "INVALID_OBJECT" };
    }
    if (this.current_location !== "Room_A") {
      return { status: "FAILED", object_id: objectId, labels: [], reason: "NOT_AT_LOCATION" };
    }
    const result = this.world.inspectObject(objectId);
    if (result === null) {
      return { status: "FAILED", object_id: objectId, labels: [], reason: "INVALID_OBJECT" };
    }
    this.last_action = `inspect_object:${objectId}`;
    this.observation_history.push(`object:${objectId}`);
    return { status: "SUCCEEDED", object_id: objectId, labels: result.labels };
  }

  stop(): StopResult {
    this.stopped = true;
    this.last_action = "stop_robot";
    return { status: "STOPPED" };
  }

  listKnownLocations(): KnownLocation[] {
    return this.world.getKnownLocations();
  }

  private failedObservation(reason: RobotToolError): ObservationResult {
    return {
      status: "FAILED",
      location: this.current_location,
      observations: [],
      object_observations: [],
      reason,
    };
  }
}
