/** Preserve native Nav2 results without treating every controller abort as system death. */
export function nav2TerminalDetails(
  actionStatus: unknown, errorCode: unknown, errorMessage: unknown, existingReason?: unknown,
): { error_code: unknown; error_msg: string | null; reason?: string } {
  const error_code = errorCode ?? null;
  const error_msg = typeof errorMessage === "string" ? errorMessage : null;
  const status = String(actionStatus ?? "");
  if (status === "SUCCEEDED") return { error_code, error_msg };
  if (status === "CANCELED") return { error_code, error_msg, reason: "ROBOT_STOPPED" };
  if (status === "ABORTED") {
    // PATH_BLOCKED requires its own obstacle evidence. A controller code alone
    // neither proves a physical collision nor proves that Nav2 is unavailable.
    if (existingReason === "PATH_BLOCKED")
      return { error_code, error_msg, reason: "PATH_BLOCKED" };
    if (Number(error_code) === 104)
      return { error_code, error_msg, reason: "CONTROLLER_PATIENCE_EXCEEDED" };
    const specific = typeof existingReason === "string" &&
      !["", "UNKNOWN", "NAVIGATION_SYSTEM_UNHEALTHY"].includes(existingReason);
    return { error_code, error_msg, reason: specific ? existingReason : "NAVIGATION_ABORTED" };
  }
  return { error_code, error_msg, ...(typeof existingReason === "string" ? { reason: existingReason } : {}) };
}

export function normalizeNavigationTerminalResult<T extends Record<string, any>>(result: T): T {
  if (!["SUCCEEDED", "ABORTED", "CANCELED", "REJECTED"].includes(result?.action_status)) return result;
  const details = nav2TerminalDetails(result.action_status,
    result.error_code ?? result.result?.error_code, result.error_msg ?? result.result?.error_msg, result.reason);
  const normalized: Record<string, any> = { ...result, ...details };
  if (result.action_status === "SUCCEEDED") delete normalized.reason;
  return normalized as T;
}
