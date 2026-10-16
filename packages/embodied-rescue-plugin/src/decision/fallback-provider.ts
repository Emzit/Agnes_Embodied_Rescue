import type {
  CandidateAction,
  DecisionInput,
  DecisionProvider,
  DecisionResult,
} from "./types.ts";

export type FallbackWeights = {
  safety: number;
  success: number;
  cost: number;
  information_gain: number;
};

export const DEFAULT_FALLBACK_WEIGHTS: FallbackWeights = {
  safety: 0.4,
  success: 0.35,
  cost: 0.1,
  information_gain: 0.15,
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

// Higher is better for safety, success, and information gain.
// Cost is also represented as a benefit: low cost contributes more.
export const scoreCandidate = (
  candidate: CandidateAction,
  weights: FallbackWeights = DEFAULT_FALLBACK_WEIGHTS,
): number => {
  const { safety, success, cost, information_gain } = candidate.features;
  return Number(
    (
      weights.safety * clamp(safety) +
      weights.success * clamp(success) +
      weights.cost * (1 - clamp(cost)) +
      weights.information_gain * clamp(information_gain)
    ).toFixed(6),
  );
};

export class FallbackDecisionProvider implements DecisionProvider {
  readonly name = "fallback" as const;
  readonly available = true;
  readonly weights: FallbackWeights;

  constructor(weights: FallbackWeights = DEFAULT_FALLBACK_WEIGHTS) {
    this.weights = weights;
  }

  decide(input: DecisionInput): DecisionResult {
    const scores = Object.fromEntries(
      input.candidates.map((candidate) => [
        candidate.id,
        scoreCandidate(candidate, this.weights),
      ]),
    );

    const selected_action = input.candidates.reduce<CandidateAction | null>(
      (best, candidate) => {
        if (best === null || scores[candidate.id] > scores[best.id]) {
          return candidate;
        }
        return best;
      },
      null,
    );

    return {
      selected_action,
      scores,
      reason_codes:
        selected_action === null
          ? ["NO_CANDIDATES"]
          : ["WEIGHTED_SCORE", "FALLBACK_PROVIDER"],
      provider_name: this.name,
    };
  }
}
