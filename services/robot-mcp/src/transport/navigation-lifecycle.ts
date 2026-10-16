export type NavigationLifecycleState =
  | "REQUESTED" | "ACCEPTED" | "EXECUTING" | "CANCELING"
  | "SUCCEEDED" | "ABORTED" | "CANCELED" | "TIMEOUT" | "UNKNOWN";

export type NavigationLifecycleEvent = {
  type: "accepted" | "feedback" | "timeout" | "cancel_requested" | "terminal";
  at: number;
  goalId?: string;
  status?: "SUCCEEDED" | "ABORTED" | "CANCELED" | "UNKNOWN";
  source?: string;
};

/** Pure ownership state machine used by transport tests and audit tooling. */
export class NavigationLifecycle {
  readonly operationId: string;
  readonly target: string;
  state: NavigationLifecycleState = "REQUESTED";
  terminalKnown = false;
  goalId: string | null = null;
  events: NavigationLifecycleEvent[] = [];

  constructor(operationId: string, target: string) {
    this.operationId = operationId;
    this.target = target;
  }

  accepted(goalId: string, at = Date.now()): void {
    if (this.terminalKnown) throw new Error("TERMINAL_ALREADY_KNOWN");
    this.goalId = goalId;
    this.state = "EXECUTING";
    this.events.push({ type: "accepted", at, goalId });
  }

  feedback(at = Date.now()): void {
    if (this.terminalKnown) return;
    if (this.state === "REQUESTED") throw new Error("FEEDBACK_BEFORE_ACCEPT");
    this.events.push({ type: "feedback", at, goalId: this.goalId ?? undefined });
  }

  timeout(at = Date.now()): void {
    if (this.terminalKnown) throw new Error("TIMEOUT_AFTER_TERMINAL");
    this.state = "TIMEOUT";
    this.events.push({ type: "timeout", at, goalId: this.goalId ?? undefined });
  }

  cancelRequested(source: string, at = Date.now()): void {
    if (this.terminalKnown) return;
    this.state = "CANCELING";
    this.events.push({ type: "cancel_requested", at, source, goalId: this.goalId ?? undefined });
  }

  terminal(status: "SUCCEEDED" | "ABORTED" | "CANCELED" | "UNKNOWN", at = Date.now()): void {
    if (this.terminalKnown) throw new Error("DUPLICATE_TERMINAL");
    this.state = status;
    this.terminalKnown = status !== "UNKNOWN";
    this.events.push({ type: "terminal", at, status, goalId: this.goalId ?? undefined });
  }

  canStartAnotherGoal(): boolean {
    return this.terminalKnown;
  }

  snapshot() {
    return { operationId: this.operationId, target: this.target, state: this.state,
      terminalKnown: this.terminalKnown, goalId: this.goalId,
      events: structuredClone(this.events) };
  }
}
