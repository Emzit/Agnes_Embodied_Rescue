/** A cancelled provider turn cannot prove either detections or their absence. */
export function visualTurnFailure(turn: any, timedOut: boolean): string | undefined {
  if (timedOut) return "INFERENCE_TIMEOUT";
  if (turn?.stopReason === "cancelled") return "INFERENCE_CANCELLED";
  if (["error", "failed"].includes(turn?.stopReason)) return "INFERENCE_FAILED";
  return undefined;
}
