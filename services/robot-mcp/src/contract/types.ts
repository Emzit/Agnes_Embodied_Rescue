export type LocationName =
  | "Start"
  | "Room_A"
  | "Room_B"
  | "Room_C"
  | "Corridor_A"
  | "Side_Corridor";

export type RobotToolError =
  | "PATH_BLOCKED"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "ROBOT_STOPPED"
  | "UNKNOWN"
  | "INVALID_LOCATION"
  | "INVALID_OBJECT"
  | "NOT_AT_LOCATION"
  | "NOT_CONFIGURED"
  | "NAVIGATION_SYSTEM_UNHEALTHY"
  | "UNAVAILABLE";

export type RobotPose = {
  location: string;
  x?: number;
  y?: number;
  heading?: number;
};

export type RobotState = {
  current_location: string;
  pose: RobotPose;
  stopped: boolean;
  last_action: string | null;
  navigation_history: string[];
  observation_history: string[];
  battery_percent: number;
};

export type LocationState = {
  name: string;
  kind: "START" | "ROOM" | "CORRIDOR";
  traversable: boolean;
  blocked_by?: string;
};

export type RouteState = {
  from: string;
  to: string;
  status: "OPEN" | "BLOCKED";
  cost: number;
  obstacle_id?: string;
};

export type KnownLocation = {
  name: LocationName;
  kind: LocationState["kind"];
  description: string;
};

// This type deliberately excludes simulator-only occupants and target positions.
export type WorldState = {
  locations: LocationState[];
  routes: RouteState[];
  known_locations: KnownLocation[];
};

export type ObjectLabel = {
  name: string;
  confidence: number;
};

export type Observation = {
  observation_id: string;
  subject: string;
  kind: "ROOM" | "OBJECT" | "TARGET" | "HAZARD";
  location: string;
  confidence: number;
};

export type ObjectObservation = {
  object_id: string;
  location: string;
  labels: ObjectLabel[];
};

export type GetObservationInput = {
  object_id?: string;
};

export type ObservationResult = {
  status: "SUCCEEDED" | "FAILED";
  location: string;
  observations: Observation[];
  object_observations: ObjectObservation[];
  reason?: RobotToolError;
};

export type NavigationResult = {
  status: "SUCCEEDED" | "FAILED";
  target: string;
  reason?: RobotToolError;
  error_code?: "NOT_CONFIGURED" | "UNAVAILABLE";
  blocked_route?: string;
  obstacle_id?: string;
};

export type RoomInspectionResult = {
  status: "SUCCEEDED" | "FAILED";
  room: string;
  observations: Observation[];
  object_observations: ObjectObservation[];
  reason?: RobotToolError;
};

export type ObjectInspectionResult = {
  status: "SUCCEEDED" | "FAILED";
  object_id: string;
  labels: ObjectLabel[];
  reason?: RobotToolError;
};

export type InspectionResult = RoomInspectionResult | ObjectInspectionResult;

export type StopResult = {
  status: "STOPPED" | "FAILED";
  reason?: RobotToolError;
};

export type RobotToolUnavailable = {
  status: "UNAVAILABLE";
  error_code: "NOT_CONFIGURED" | "UNAVAILABLE";
  message: string;
};

export type RobotGateway = {
  getState(): RobotState | RobotToolUnavailable;
  getWorldState(): WorldState | RobotToolUnavailable;
  getObservation(input?: GetObservationInput): ObservationResult | RobotToolUnavailable;
  navigateTo(location: string): NavigationResult;
  inspectRoom(location: string): RoomInspectionResult;
  inspectObject(objectId: string): ObjectInspectionResult;
  stop(): StopResult;
  listKnownLocations(): KnownLocation[] | RobotToolUnavailable;
};
