import assert from "node:assert/strict";
import test from "node:test";
import {
  FallbackDecisionProvider,
  decideSafely,
  type CandidateAction,
} from "../src/decision/provider.ts";
import { createInitialMissionState } from "../src/backend/mission-state.ts";

const candidates: CandidateAction[] = [
  {
    id: "route_room_c",
    type: "navigate",
    target: "Room C",
    features: { safety: 0.9, success: 0.9, cost: 0.6, information_gain: 0.3 },
  },
  {
    id: "push_obstacle",
    type: "push",
    features: { safety: 0.3, success: 0.4, cost: 0.5, information_gain: 0.2 },
  },
  {
    id: "wait",
    type: "wait",
    features: { safety: 1.0, success: 0.1, cost: 0.1, information_gain: 0.0 },
  },
];

test("fallback selects route_room_c with transparent weighted scoring", () => {
  const provider = new FallbackDecisionProvider();
  const result = provider.decide({
    goal: "reach the target safely",
    world_state: createInitialMissionState().world_memory,
    candidates,
  });

  assert.equal(result.provider_name, "fallback");
  assert.equal(result.selected_action?.id, "route_room_c");
  assert.deepEqual(result.reason_codes, ["WEIGHTED_SCORE", "FALLBACK_PROVIDER"]);
  assert.equal(result.scores.route_room_c, 0.76);
});

test("malformed model candidates return a structured no-selection instead of throwing", () => {
  const result = decideSafely({
    goal: "find the requested person",
    world_state: {},
    candidates: [{ option: "navigate_to_Room_C" }],
  });
  assert.equal(result.selected_action, null);
  assert.deepEqual(result.reason_codes, ["INVALID_DECISION_INPUT"]);
});

test("candidate scoring rejects nonnumeric features without producing an action", () => {
  const result = decideSafely({
    goal: "choose a useful next step",
    world_state: {},
    candidates: [{ id: "room_c", type: "navigate", features: {
      safety: true, success: true, cost: "low", information_gain: 0.5,
    } }],
  });
  assert.equal(result.selected_action, null);
  assert.deepEqual(result.reason_codes, ["INVALID_DECISION_INPUT"]);
});
