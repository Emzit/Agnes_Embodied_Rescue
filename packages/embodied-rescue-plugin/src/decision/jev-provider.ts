import type {
  DecisionInput,
  DecisionProvider,
  DecisionResult,
} from "./types.ts";

export class JevDecisionProvider implements DecisionProvider {
  readonly name = "jev" as const;
  readonly available = false;

  decide(_input: DecisionInput): DecisionResult {
    // A real Jev adapter must be supplied before this provider can decide.
    return {
      selected_action: null,
      scores: {},
      reason_codes: ["NOT_CONFIGURED", "UNAVAILABLE"],
      provider_name: this.name,
    };
  }
}
