import { FallbackDecisionProvider } from "./fallback-provider.ts";
import { JevDecisionProvider } from "./jev-provider.ts";
import type { CandidateAction, DecisionInput, DecisionProvider, DecisionResult } from "./types.ts";

export const selectDecisionProvider = (
  jev: DecisionProvider = new JevDecisionProvider(),
  fallback: DecisionProvider = new FallbackDecisionProvider(),
): DecisionProvider => (jev.available ? jev : fallback);

export const decideWithAvailableProvider = (
  input: DecisionInput,
  jev: DecisionProvider = new JevDecisionProvider(),
  fallback: DecisionProvider = new FallbackDecisionProvider(),
): DecisionResult => selectDecisionProvider(jev, fallback).decide(input);

const isCandidateAction = (value: unknown): value is CandidateAction => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CandidateAction>;
  if (typeof candidate.id !== "string" || !candidate.id.trim() || typeof candidate.type !== "string" || !candidate.type.trim()) return false;
  if (!candidate.features || typeof candidate.features !== "object") return false;
  const features = candidate.features as Record<string, unknown>;
  return ["safety", "success", "cost", "information_gain"].every((key) =>
    typeof features[key] === "number" && Number.isFinite(features[key]) && features[key] >= 0 && features[key] <= 1
  );
};

// Model-produced candidate payloads are untrusted input. Reject malformed
// inputs as a structured no-selection result instead of throwing through the
// plugin host and converting a planning mistake into a failed Agent turn.
export const decideSafely = (value: unknown): DecisionResult => {
  const input = value as Partial<DecisionInput> | null;
  if (!input || typeof input.goal !== "string" || !input.goal.trim() ||
      !input.world_state || typeof input.world_state !== "object" ||
      !Array.isArray(input.candidates) || !input.candidates.every(isCandidateAction)) {
    return { selected_action: null, scores: {}, reason_codes: ["INVALID_DECISION_INPUT"], provider_name: "fallback" };
  }
  try {
    return decideWithAvailableProvider(input as DecisionInput);
  } catch {
    return { selected_action: null, scores: {}, reason_codes: ["DECISION_PROVIDER_ERROR"], provider_name: "fallback" };
  }
};

export type { DecisionInput, DecisionProvider, DecisionResult } from "./types.ts";
export type { CandidateAction, CandidateFeatures } from "./types.ts";
export { FallbackDecisionProvider, scoreCandidate } from "./fallback-provider.ts";
export { JevDecisionProvider } from "./jev-provider.ts";
