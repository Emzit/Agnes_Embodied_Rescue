import test from "node:test";
import assert from "node:assert/strict";
import {visualTurnFailure} from "../perception/vlm-turn.ts";
test("a timed-out cancelled native turn is a model timeout, not invalid image JSON",()=>{
 assert.equal(visualTurnFailure({stopReason:"cancelled",reason:"aborted"},true),"INFERENCE_TIMEOUT");
});
test("cancellation and provider failures cannot become a successful empty detection",()=>{
 assert.equal(visualTurnFailure({stopReason:"cancelled"},false),"INFERENCE_CANCELLED");
 assert.equal(visualTurnFailure({stopReason:"error"},false),"INFERENCE_FAILED");
 assert.equal(visualTurnFailure({stopReason:"end_turn"},false),undefined);
});
