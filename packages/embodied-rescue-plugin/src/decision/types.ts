import type { WorldMemory } from "../backend/world-memory.ts";

export type CandidateFeatures = {
  safety: number;
  success: number;
  cost: number;
  information_gain: number;
};

export type CandidateAction = {
  id: string;
  type: string;
  target?: string;
  features: CandidateFeatures;
  metadata?: Record<string, string | number | boolean>;
};

export type DecisionInput = {
  goal: string;
  world_state: WorldMemory;
  candidates: CandidateAction[];
};

export type DecisionResult = {
  selected_action: CandidateAction | null;
  scores: Record<string, number>;
  reason_codes: string[];
  provider_name: "fallback" | "jev";
};

export type DecisionProvider = {
  readonly name: "fallback" | "jev";
  readonly available: boolean;
  decide(input: DecisionInput): DecisionResult;
};
