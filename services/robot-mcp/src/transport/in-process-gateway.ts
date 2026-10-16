import type {
  GetObservationInput,
  NavigationResult,
  ObjectInspectionResult,
  ObservationResult,
  RobotGateway,
  RobotState,
  RoomInspectionResult,
  StopResult,
  WorldState,
  KnownLocation,
} from "../contract/types.ts";
import type { MockRobot } from "../mock/robot.ts";

export class InProcessRobotGateway implements RobotGateway {
  private readonly robot: MockRobot;

  constructor(robot: MockRobot) {
    this.robot = robot;
  }

  getState(): RobotState {
    return this.robot.getState();
  }

  getWorldState(): WorldState {
    return this.robot.getWorldState();
  }

  getObservation(input?: GetObservationInput): ObservationResult {
    return this.robot.getObservation(input);
  }

  navigateTo(location: string): NavigationResult {
    return this.robot.navigateTo(location);
  }

  inspectRoom(location: string): RoomInspectionResult {
    return this.robot.inspectRoom(location);
  }

  inspectObject(objectId: string): ObjectInspectionResult {
    return this.robot.inspectObject(objectId);
  }

  stop(): StopResult {
    return this.robot.stop();
  }

  listKnownLocations(): KnownLocation[] {
    return this.robot.listKnownLocations();
  }
}
