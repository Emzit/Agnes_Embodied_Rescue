import type {
  ObjectLabel,
  ObjectObservation,
  Observation,
} from "../contract/types.ts";

export const OBJECT_17_ID = "object_17";
export const RESEARCHER_01_ID = "researcher_01";

export const passiveObjectLabels = (): ObjectLabel[] => [
  { name: "fire_extinguisher", confidence: 0.55 },
  { name: "toolbox", confidence: 0.38 },
];

export const activeObjectLabels = (): ObjectLabel[] => [
  { name: "fire_extinguisher", confidence: 0.94 },
  { name: "toolbox", confidence: 0.38 },
];

export const createObjectObservation = (
  labels: ObjectLabel[],
  location = "Room_A",
): ObjectObservation => ({
  object_id: OBJECT_17_ID,
  location,
  labels,
});

export const createResearcherObservation = (): Observation => ({
  observation_id: "observation:researcher_01",
  subject: RESEARCHER_01_ID,
  kind: "TARGET",
  location: "Room_B",
  confidence: 1,
});
