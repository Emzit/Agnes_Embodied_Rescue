import type {
  KnownLocation,
  LocationName,
  ObjectObservation,
  Observation,
  ObservationResult,
  RoomInspectionResult,
  RouteState,
  WorldState,
} from "../contract/types.ts";
import {
  activeObjectLabels,
  createObjectObservation,
  createResearcherObservation,
  OBJECT_17_ID,
  passiveObjectLabels,
} from "./observations.ts";

type Edge = { from: LocationName; to: LocationName; cost: number };

export type MockWorldEvent = {
  event: "block_corridor_a";
  obstacle_id: "cabinet_01";
  route: "Corridor_A";
};

export type MockWorldOptions = {
  dynamicRescue?: boolean;
  onEvent?: (event: MockWorldEvent) => void;
};

const LOCATION_DEFINITIONS: readonly KnownLocation[] = [
  { name: "Start", kind: "START", description: "Mission start" },
  { name: "Room_A", kind: "ROOM", description: "First search room" },
  { name: "Room_B", kind: "ROOM", description: "Research target room" },
  { name: "Room_C", kind: "ROOM", description: "Alternate search room" },
  { name: "Corridor_A", kind: "CORRIDOR", description: "Primary corridor" },
  { name: "Side_Corridor", kind: "CORRIDOR", description: "Alternate corridor" },
];

// The insertion order makes the open-world shortest route deterministic:
// Start -> Room_A -> Corridor_A -> Room_B.
const EDGES: readonly Edge[] = [
  { from: "Start", to: "Room_A", cost: 1 },
  { from: "Room_A", to: "Corridor_A", cost: 1 },
  { from: "Corridor_A", to: "Room_B", cost: 1 },
  { from: "Room_A", to: "Room_C", cost: 1 },
  { from: "Room_C", to: "Side_Corridor", cost: 1 },
  { from: "Side_Corridor", to: "Room_B", cost: 1 },
];

const edgeKey = (from: string, to: string): string =>
  [from, to].sort().join("::");

export class MockWorld {
  private readonly dynamicRescue: boolean;
  private readonly onEvent?: (event: MockWorldEvent) => void;
  private dynamicEventTriggered = false;
  private readonly eventLog: MockWorldEvent[] = [];
  private readonly blockedLocations = new Set<string>();
  private readonly blockedRoutes = new Map<
    string,
    { obstacle_id: string; route: string }
  >();

  // Simulator-only state. It is never returned from getWorldState().
  private readonly researcherLocation = "Room_B";

  constructor(options: MockWorldOptions = {}) {
    this.dynamicRescue = options.dynamicRescue ?? false;
    this.onEvent = options.onEvent;
  }

  blockCorridorA(): void {
    if (this.isLocationBlocked("Corridor_A")) return;
    this.blockedLocations.add("Corridor_A");
    this.blockedRoutes.set(edgeKey("Room_A", "Corridor_A"), {
      obstacle_id: "cabinet_01",
      route: "Corridor_A",
    });
    this.blockedRoutes.set(edgeKey("Corridor_A", "Room_B"), {
      obstacle_id: "cabinet_01",
      route: "Corridor_A",
    });
    const event: MockWorldEvent = {
      event: "block_corridor_a",
      obstacle_id: "cabinet_01",
      route: "Corridor_A",
    };
    this.eventLog.push(event);
    this.onEvent?.(event);
  }

  block_corridor_a(): void {
    this.blockCorridorA();
  }

  afterRoomInspection(location: string): void {
    if (this.dynamicRescue && location === "Room_A" && !this.dynamicEventTriggered) {
      this.dynamicEventTriggered = true;
      this.blockCorridorA();
    }
  }

  getEventLog(): MockWorldEvent[] {
    return this.eventLog.map((event) => ({ ...event }));
  }

  isLocationBlocked(location: string): boolean {
    return this.blockedLocations.has(location);
  }

  getKnownLocations(): KnownLocation[] {
    return LOCATION_DEFINITIONS.map((item) => ({ ...item }));
  }

  getWorldState(): WorldState {
    const locations: LocationState[] = LOCATION_DEFINITIONS.map((item) => ({
      name: item.name,
      kind: item.kind,
      traversable: !this.blockedLocations.has(item.name),
      ...(this.blockedLocations.has(item.name)
        ? { blocked_by: "cabinet_01" }
        : {}),
    }));
    const routes: RouteState[] = EDGES.map((edge) => {
      const blocked = this.blockedRoutes.get(edgeKey(edge.from, edge.to));
      return {
        from: edge.from,
        to: edge.to,
        status: blocked ? "BLOCKED" : "OPEN",
        cost: edge.cost,
        ...(blocked ? { obstacle_id: blocked.obstacle_id } : {}),
      };
    });
    return {
      locations,
      routes,
      known_locations: this.getKnownLocations(),
    };
  }

  // BFS over the static graph. Dynamic obstacles are checked separately so
  // the robot reports a blocked planned route instead of silently rerouting.
  findPath(from: string, to: string): string[] | null {
    if (!LOCATION_DEFINITIONS.some((item) => item.name === from)) return null;
    if (!LOCATION_DEFINITIONS.some((item) => item.name === to)) return null;
    const queue: string[][] = [[from]];
    const visited = new Set<string>([from]);
    while (queue.length > 0) {
      const path = queue.shift() as string[];
      const current = path[path.length - 1];
      if (current === to) return path;
      for (const edge of EDGES) {
        const next =
          edge.from === current
            ? edge.to
            : edge.to === current
              ? edge.from
              : null;
        if (next !== null && !visited.has(next)) {
          visited.add(next);
          queue.push([...path, next]);
        }
      }
    }
    return null;
  }

  getBlockedRoute(path: string[]):
    | { blocked_route: string; obstacle_id: string }
    | undefined {
    for (let index = 1; index < path.length; index += 1) {
      const blocked = this.blockedRoutes.get(edgeKey(path[index - 1], path[index]));
      if (blocked) {
        return {
          blocked_route: blocked.route,
          obstacle_id: blocked.obstacle_id,
        };
      }
    }
    return undefined;
  }

  private getPassiveObjectObservation(
    location: string,
  ): ObjectObservation[] {
    if (location !== "Room_A") return [];
    return [createObjectObservation(passiveObjectLabels())];
  }

  getObservation(location: string, objectId?: string): ObservationResult {
    const object_observations = this.getPassiveObjectObservation(location);
    if (objectId && objectId !== OBJECT_17_ID) {
      return {
        status: "FAILED",
        location,
        observations: [],
        object_observations: [],
        reason: "INVALID_OBJECT",
      };
    }
    return {
      status: "SUCCEEDED",
      location,
      observations: [],
      object_observations,
    };
  }

  inspectRoom(location: string): RoomInspectionResult {
    const observations: Observation[] = [];
    if (location === this.researcherLocation) {
      observations.push(createResearcherObservation());
    }
    return {
      status: "SUCCEEDED",
      room: location,
      observations,
      object_observations: this.getPassiveObjectObservation(location),
    };
  }

  inspectObject(objectId: string): { labels: ReturnType<typeof activeObjectLabels> } | null {
    if (objectId !== OBJECT_17_ID) return null;
    return { labels: activeObjectLabels() };
  }

}
