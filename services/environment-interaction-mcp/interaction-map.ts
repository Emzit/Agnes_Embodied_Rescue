import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { WorldRegistry } from "../robot-mcp/src/transport/world-registry.ts";

const ROOT = "/data-ssd/zhongchengkai/agnes";
export function readInteractionMap(registryPath: string, worldRegistryPath: string | undefined, worldName: string) {
  const locationPath = worldRegistryPath || dirname(registryPath) + "/world_registry.json";
  for (const path of [registryPath, locationPath]) {
    if (!path || !resolve(path).startsWith(ROOT + "/")) throw new Error("MAP_PRIOR_OUTSIDE_WORKSPACE");
  }
  const locations = WorldRegistry.load(locationPath).list();
  const prior = JSON.parse(readFileSync(registryPath, "utf8"));
  if (!Array.isArray(prior.doors)) throw new Error("INVALID_DOOR_MAP_PRIOR");
  const doors = prior.doors.map((d: any) => {
    const interaction_location = d.id + "_interaction";
    if (typeof d.id !== "string" || !Array.isArray(d.connects) || !d.connects.every((id: string) => locations.some(l => l.id === id))
        || !locations.some(l => l.id === interaction_location)) throw new Error("UNREGISTERED_DOOR_INTERACTION");
    return { id: d.id, connects: d.connects, at: d.at, interaction_pose: d.interaction_pose,
      interaction_location, mechanism: d.mechanism, runtime_state: "UNKNOWN" };
  });
  return { status: "SUCCEEDED", source: "static_map_prior", map_prior_only: true, world_name: worldName, locations, doors,
    door_workflow: ["Choose the current map door connecting the requested room.",
      "Navigate to interaction_location outside the room and confirm arrival with get_robot_state.",
      "Call inspect_door for fresh Agnes camera evidence, then call open_door.",
      "Keep dependent navigation, inspection and opening sequential; leave the opened door open."],
    limitations: "The map does not observe door state, fire, people or objects. Door state must be verified using inspect_door." };
}
