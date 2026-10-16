import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient, memoryJournal } from "../third_party/agnes-harness/packages/sdk/src/index.node.ts";

const root = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const home = join(root, ".agh-home-step7");
const profile = "local-dev";
const artifactsRoot = join(root, process.env.STEP7_ARTIFACT_DIR ?? "artifacts/step7");
const logsRoot = join(root, "logs/step7");
const eventLog = join(logsRoot, "robot-events-setup.jsonl");
const nodeBin = join(root, "tools/node/bin/node");
const cliEntry = join(root, "third_party/agnes-harness/packages/cli/dist/local/agnes.mjs");
const mcpServerId = "robot-mcp";
const expectedProvider = "agnes-ai";
const expectedModel = "agnes-3.0-flash";
const pluginTools = new Set([
  "mission_get_state",
  "mission_reset",
  "world_memory_get",
  "world_memory_update",
  "decision_score_candidates",
]);
const mcpTools = new Set([
  "get_robot_state",
  "get_world_state",
  "get_observation",
  "navigate_to",
  "inspect_room",
  "inspect_object",
  "stop_robot",
  "list_known_locations",
]);

const mcpToolPrefix = (serverId: string): string => {
  const slug = serverId
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "server";
  const hash = createHash("sha256").update(serverId, "utf8").digest("hex").slice(0, 8);
  return `mcp_${slug}_${hash}_`;
};

const prefix = mcpToolPrefix(mcpServerId);
const execFileAsync = promisify(execFile);

const cliEnv = {
  PATH: `${join(root, "tools/node/bin")}:${process.env.PATH ?? ""}`,
  HOME: join(root, ".runtime-step7/home"),
  AGH_HOME: home,
  AGNES_PROFILE: profile,
  AGNES_MCP_STDIO_ALLOWLIST: nodeBin,
  TMPDIR: join(root, ".tmp"),
  XDG_CACHE_HOME: join(root, ".cache"),
  XDG_CONFIG_HOME: join(root, ".runtime-step7/config"),
  XDG_DATA_HOME: join(root, ".runtime-step7/data"),
  COREPACK_HOME: join(root, ".corepack"),
  HTTP_PROXY: "http://127.0.0.1:7898",
  HTTPS_PROXY: "http://127.0.0.1:7898",
  http_proxy: "http://127.0.0.1:7898",
  https_proxy: "http://127.0.0.1:7898",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  NODE_USE_ENV_PROXY: "1",
  LANG: process.env.LANG ?? "C.UTF-8",
};

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function safeErrorMeta(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const value = error as Record<string, unknown>;
  const candidates = [
    value.kind,
    value.code,
    (value.data as Record<string, unknown> | undefined)?.code,
    (value.rpc as Record<string, unknown> | undefined)?.data &&
      ((value.rpc as Record<string, unknown>).data as Record<string, unknown>).code,
    ((value.data as Record<string, unknown> | undefined)?.error as Record<string, unknown> | undefined)?.code,
  ];
  const safe = candidates.find((candidate) =>
    typeof candidate === "string" && /^[A-Z][A-Z0-9_-]{1,64}$/.test(candidate),
  );
  return typeof safe === "string" ? safe : "UNKNOWN";
}

async function readJsonLines(path: string): Promise<unknown[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const safeArgs = (args: unknown): unknown => {
  if (!args || typeof args !== "object") return args;
  return structuredClone(args);
};

function summarizeStructured(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of [
    "ok",
    "code",
    "message",
    "status",
    "target",
    "reason",
    "blocked_route",
    "obstacle_id",
    "provider_name",
    "selected_action",
    "robot_location",
    "searched_rooms",
    "blocked_routes",
    "target_status",
    "replans_count",
    "active_perception_count",
    "object_observations",
    "labels",
    "observations",
    "known_objects",
    "current_location",
    "navigation_history",
    "locations",
    "routes",
    "known_locations",
    "world_memory",
  ]) {
    if (key in source) {
      summary[key] = key === "world_memory" ? summarizeStructured(source[key]) : source[key];
    }
  }
  return summary;
}

function extractStructured(detail: any): unknown {
  let value = detail.result?.structured;
  if (value === undefined) {
    const text = detail.result?.content?.find((block: any) => block.type === "text")?.text;
    if (typeof text === "string") {
      try {
        value = JSON.parse(text);
      } catch {
        value = undefined;
      }
    }
  }
  return value;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.content)) return record.content.map(textFromContent).filter(Boolean).join("\n");
  return "";
}

async function waitResourceOperation(client: any, receipt: any): Promise<void> {
  for (;;) {
    const operation = await client.resources.operation.get({
      profile,
      operationId: receipt.operationId,
    });
    if (["failed", "cancelled"].includes(operation.state)) {
      throw new Error("MCP reconnect operation failed");
    }
    if (operation.state === "succeeded") return;
    await sleep(100);
  }
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(nodeBin, [cliEntry, ...args], {
    cwd: root,
    env: cliEnv,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result;
}

async function restartDaemon(): Promise<void> {
  try {
    await runCli(["daemon", "stop"]);
  } catch {
    // A stopped daemon is the desired state before the official start command.
  }
  await runCli(["daemon", "start"]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const status = await runCli(["daemon", "status"]);
      if (status.stdout.includes('"running":true')) return;
    } catch {
      // Keep polling the isolated Step 7 daemon.
    }
    await sleep(100);
  }
  throw new Error("daemon did not become ready");
}

async function connectClient(): Promise<any> {
  const owner = JSON.parse(await readFile(join(home, "data/daemon/owner.json"), "utf8"));
  const client: any = createClient({
    transport: { kind: "unix", path: owner.socketPath },
    auth: { kind: "local" },
    journal: memoryJournal(),
  });
  await client.initialize();
  return client;
}

async function reconnectMockRobot(client: any): Promise<any> {
  const descriptor = await client.mcp.servers.get({ profile, serverId: mcpServerId });
  await waitResourceOperation(
    client,
    await client.mcp.servers.reconnect({
      profile,
      serverId: mcpServerId,
      expectedRevision: descriptor.revision,
      clientId: await client.clientId(),
      commandId: `step7-baseline-reconnect-${Date.now()}`,
    }),
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await client.mcp.servers.status({ profile, serverId: mcpServerId });
    if (status.connectionState === "ready") return status;
    await sleep(100);
  }
  throw new Error("MCP did not become ready");
}

async function collectToolTrace(session: any, events: any[]): Promise<any[]> {
  const calls = events.filter((event) => event.type === "tool/call");
  const results = events.filter((event) => event.type === "tool/result");
  const trace: any[] = [];
  for (const event of calls) {
    const resultEvent = results.find((candidate) => candidate.data?.toolUseId === event.data?.toolUseId);
    const detail = await session.readToolDetail(event.seq, resultEvent?.seq);
    const name = detail.call.name;
    const structured = extractStructured(detail);
    trace.push({
      seq: event.seq,
      result_seq: resultEvent?.seq,
      domain: pluginTools.has(name) ? "plugin" : name.startsWith(prefix) ? "mcp" : "unknown",
      tool: name,
      args: safeArgs(detail.call.args),
      result: structured === undefined ? { content: detail.result?.content ?? [] } : summarizeStructured(structured),
      is_error: detail.result?.isError ?? null,
    });
  }
  return trace;
}

function missionMemory(trace: any[]): any {
  const state = [...trace]
    .reverse()
    .find((entry) =>
      pluginTools.has(entry.tool) &&
      ["mission_get_state", "world_memory_get", "world_memory_update"].includes(entry.tool),
    )?.result;
  return state?.world_memory ?? state ?? null;
}

function hasLabel(result: any, label: string, confidence: number): boolean {
  const observations = result?.object_observations ?? [];
  const observationLabels = observations.some((observation: any) =>
    observation.labels?.some(
      (item: any) => item.name === label && Math.abs(Number(item.confidence) - confidence) < 0.001,
    ),
  );
  const directLabels = result?.labels?.some(
    (item: any) => item.name === label && Math.abs(Number(item.confidence) - confidence) < 0.001,
  );
  return observationLabels || directLabels === true;
}

function getLabels(result: any): Array<{ name: string; confidence: number }> {
  const labels: Array<{ name: string; confidence: number }> = [];
  for (const observation of result?.object_observations ?? []) {
    for (const label of observation?.labels ?? []) {
      if (typeof label?.name === "string" && Number.isFinite(Number(label.confidence))) {
        labels.push({ name: label.name, confidence: Number(label.confidence) });
      }
    }
  }
  for (const label of result?.labels ?? []) {
    if (typeof label?.name === "string" && Number.isFinite(Number(label.confidence))) {
      labels.push({ name: label.name, confidence: Number(label.confidence) });
    }
  }
  return labels;
}

function evaluateRun(trace: any[], eventDelta: any[], answer: string, turn: any, provider: any, run: number) {
  const blockedIndex = trace.findIndex((entry) => entry.result?.reason === "PATH_BLOCKED");
  const roomBInspectionIndex = trace.findIndex(
    (entry) => entry.tool === `${prefix}inspect_room` && entry.args?.location === "Room_B",
  );
  const researcherIndex = trace.findIndex((entry) =>
    entry.result?.observations?.some((observation: any) => observation.subject === "researcher_01"),
  );
  const worldChecks = trace.filter((entry) => entry.tool === `${prefix}get_world_state`);
  const earlyGroundTruthLeak = worldChecks.some((entry) => JSON.stringify(entry.result).includes("researcher_01"));
  const blockedEvent = eventDelta.some((event: any) => event.event === "block_corridor_a");
  const successfulNavigations = trace.filter(
    (entry) => entry.tool === `${prefix}navigate_to` && entry.result?.status === "SUCCEEDED",
  );
  const postBlockNavigation = blockedIndex >= 0 && successfulNavigations.some(
    (entry) => entry.seq > trace[blockedIndex].seq,
  );
  const finalMemory = missionMemory(trace);
  const replanCountObserved = trace.reduce(
    (max, entry) => Math.max(max, Number(entry.result?.replans_count ?? 0)),
    0,
  );
  const replanned = Math.max(Number(finalMemory?.replans_count ?? 0), replanCountObserved) >= 1;
  const replanIfBlocked = blockedEvent
    ? blockedIndex >= 0 && replanned && postBlockNavigation ? "PASS" : "FAIL"
    : "NOT_TRIGGERED";
  const observations = trace
    .map((entry) => ({ entry, labels: getLabels(entry.result) }))
    .filter((item) => item.labels.length > 0);
  const lowConfidenceObservation = observations.find((item) =>
    item.labels.some((label) => label.confidence < 0.8),
  );
  const activeInspections = trace.filter((entry) => entry.tool === `${prefix}inspect_object`);
  const activeInspection = activeInspections[0];
  const activePerceptionRequired = lowConfidenceObservation !== undefined;
  const activePerceptionResult = !activePerceptionRequired
    ? "NOT_TRIGGERED"
    : activeInspections.some((entry) => entry.seq > lowConfidenceObservation.entry.seq)
      ? "PASS"
      : "FAIL";
  const finalFound = String(finalMemory?.target_status ?? "").toUpperCase() === "FOUND";
  const targetReport = /(researcher_01|researcher|研究员)/i.test(answer);
  const blockageEvidence = blockedEvent || blockedIndex >= 0 || (finalMemory?.blocked_routes?.length ?? 0) > 0;
  const blockageReport = !blockageEvidence || /(blocked|阻塞|受阻|PATH_BLOCKED|路线|路径|hazard|风险|危险)/i.test(answer);
  const confirmedLabels = [...new Set(activeInspections
    .flatMap((entry) => getLabels(entry.result))
    .filter((label) => label.confidence >= 0.8)
    .map((label) => label.name))];
  const objectEvidence = confirmedLabels.length > 0;
  const confirmedObjectReport = !objectEvidence || confirmedLabels.some((label) => answer.includes(label));
  const finalReportCore = targetReport && blockageReport;
  const finalReport = finalReportCore && confirmedObjectReport;
  const completionResetAttempts = researcherIndex < 0
    ? []
    : trace.slice(researcherIndex + 1).filter((entry) => entry.tool === "mission_reset");
  const rejectedCompletionReset = completionResetAttempts.some(
    (entry) => entry.result?.code === "MISSION_ALREADY_COMPLETE",
  );
  const successfulCompletionReset = completionResetAttempts.some(
    (entry) => entry.result?.code !== "MISSION_ALREADY_COMPLETE" && entry.result?.status === "IDLE",
  );
  const postCompletionReset = completionResetAttempts.length === 0
    ? "PASS"
    : successfulCompletionReset
      ? "FAIL"
      : rejectedCompletionReset
        ? "PASS_WITH_REJECTED_ATTEMPT"
        : "FAIL";
  const postCompletionResetGuardResult = completionResetAttempts.length === 0
    ? "NOT_ATTEMPTED"
    : rejectedCompletionReset
      ? "REJECTED"
      : successfulCompletionReset
        ? "BYPASSED"
        : "UNKNOWN";
  const finalMissionRead = trace.findLastIndex((entry) => entry.tool === "mission_get_state");
  const finalMemoryRead = trace.findLastIndex((entry) => entry.tool === "world_memory_get");
  const missionSuccess =
    provider.id === expectedProvider &&
    provider.model === expectedModel &&
    trace.some((entry) => entry.domain === "plugin") &&
    trace.some((entry) => entry.domain === "mcp") &&
    !earlyGroundTruthLeak &&
    roomBInspectionIndex >= 0 &&
    researcherIndex >= roomBInspectionIndex &&
    finalFound &&
    finalReportCore;
  const behaviorIssues: string[] = [];
  if (activePerceptionResult === "FAIL") behaviorIssues.push("LOW_CONFIDENCE_NOT_REINSPECTED");
  if (!confirmedObjectReport && objectEvidence) {
    behaviorIssues.push("FINAL_REPORT_MISSING_CONFIRMED_OBJECT");
  }
  if (postCompletionReset === "FAIL") behaviorIssues.push("MISSION_RESET_AFTER_TARGET_FOUND");
  return {
    run,
    pass: missionSuccess,
    mission_success: missionSuccess,
    scenario_coverage: {
      dynamic_blockage_triggered: blockedEvent,
      replan_if_blocked: replanIfBlocked,
      low_confidence_observed: activePerceptionRequired,
      active_perception_required: activePerceptionRequired,
      active_perception_if_required: activePerceptionResult,
    },
    session_id: provider.sessionId,
    turn_reason: turn.reason,
    provider: provider.id,
    model: provider.model,
    real_llm: true,
    plugin_tool_count: trace.filter((entry) => entry.domain === "plugin").length,
    mcp_tool_count: trace.filter((entry) => entry.domain === "mcp").length,
    total_tool_calls: trace.length,
    path_blocked: blockedIndex >= 0,
    blocked_event: blockedEvent,
    replans_count: finalMemory?.replans_count ?? null,
    max_replans_observed: Math.max(Number(finalMemory?.replans_count ?? 0), replanCountObserved),
    active_perception_count: finalMemory?.active_perception_count ?? null,
    active_inspect_object: activeInspections.length > 0,
    alternate_route: postBlockNavigation,
    target_status: finalMemory?.target_status ?? null,
    researcher_found: researcherIndex >= 0,
    researcher_early_leak: earlyGroundTruthLeak,
    scripted_tool_sequence: false,
    provider_name: trace.find((entry) => entry.tool === "decision_score_candidates")?.result?.provider_name ?? null,
    selected_action: trace.find((entry) => entry.tool === "decision_score_candidates")?.result?.selected_action ?? null,
    final_report_mentions_required_facts: finalReport,
    final_report_core_complete: finalReportCore,
    final_report_completeness: finalReport ? "PASS" : "FAIL",
    finalization_checklist: {
      final_mission_get_state: finalMissionRead >= 0,
      final_world_memory_get: finalMemoryRead >= 0,
    },
    attempted_post_completion_reset: completionResetAttempts.length > 0,
    post_completion_reset: postCompletionReset,
    post_completion_reset_guard_result: postCompletionResetGuardResult,
    behavior_issues: behaviorIssues,
  };
}

async function runOne(client: any, run: number, provider: any): Promise<any> {
  let stage = "reconnect";
  await reconnectMockRobot(client);
  const beforeEvents = await readJsonLines(eventLog);
  const runDir = join(artifactsRoot, `run-${run}`);
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  let session: any;
  let removePermission: (() => void) | undefined;
  let eventIterator: AsyncIterator<any> | undefined;
  let eventReader: Promise<void> | undefined;
  const events: any[] = [];
  try {
    stage = "session.new";
    session = await client.session.new({
      cwd: root,
      sessionKey: `step7-real-llm-run-${run}-${Date.now()}`,
    });
    stage = "session.attach";
    await session.attach();
    removePermission = session.onPermissionRequest(async (request: any) => {
      const name = request.toolCall?._meta?.["ai.agnes.harness"]?.tool;
      const allowed = pluginTools.has(name) || name?.startsWith(prefix);
      const option = request.options?.find((item: any) => item.kind === (allowed ? "allow_once" : "reject_once"));
      if (!option) throw new Error("permission option unavailable");
      return { optionId: option.optionId };
    });
    eventIterator = session.events()[Symbol.asyncIterator]();
    eventReader = (async () => {
      for (;;) {
        const item = await eventIterator?.next();
        if (!item || item.done) return;
        events.push(item.value);
      }
    })();
    stage = "session.prompt";
    const turn = await session.prompt(
      "使用 $embodied-rescue 方法进入实验室寻找失联研究员，并报告环境风险。请根据观察逐步行动，不要假设你知道隐藏的环境真值。如果路线受阻，请根据当前信息重新规划。如果遇到不确定的环境目标，请在需要时进一步检查。找到研究员后，报告已搜索区域、阻塞路线、重规划次数、主动感知次数和任务是否完成。",
      { signal: AbortSignal.timeout(300_000), titleLocale: "zh-CN" },
    );
    await eventIterator.return?.();
    await eventReader;
    removePermission();
    removePermission = undefined;
    stage = "tool-trace";
    const trace = await collectToolTrace(session, events);
    const answer = events
      .filter((event) => event.type === "assistant/message")
      .map((event) => textFromContent(event.data))
      .filter(Boolean)
      .join("\n\n");
    const afterEvents = await readJsonLines(eventLog);
    const eventDelta = afterEvents.slice(beforeEvents.length);
    const summary = evaluateRun(
      trace,
      eventDelta,
      answer,
      turn,
      { ...provider, sessionId: session.id },
      run,
    );
    const toolCounts = Object.fromEntries(
      [...new Set(trace.map((entry) => entry.tool))].map((tool) => [tool, trace.filter((entry) => entry.tool === tool).length]),
    );
    await writeFile(join(runDir, "tool-trace.json"), JSON.stringify({ sessionId: session.id, trace }, null, 2));
    await writeFile(join(runDir, "final-mission-state.json"), JSON.stringify(missionMemory(trace), null, 2));
    await writeFile(
      join(runDir, "provider-summary.json"),
      JSON.stringify({
        provider: expectedProvider,
        model: expectedModel,
        real_llm: true,
        session_id: session.id,
        tool_counts: toolCounts,
        decision_provider_name: summary.provider_name,
      }, null, 2),
    );
    await writeFile(join(runDir, "final-answer.txt"), answer);
    await writeFile(
      join(runDir, "acceptance.json"),
      JSON.stringify({ ...summary, event_delta: eventDelta }, null, 2),
    );
    return summary;
  } catch (error) {
    const error_code = safeErrorMeta(error);
    await writeFile(join(runDir, "tool-trace.json"), JSON.stringify({ trace: [] }, null, 2));
    await writeFile(join(runDir, "final-mission-state.json"), "null\n");
    await writeFile(
      join(runDir, "provider-summary.json"),
      JSON.stringify({ provider: expectedProvider, model: expectedModel, real_llm: true }, null, 2),
    );
    await writeFile(
      join(runDir, "acceptance.json"),
      JSON.stringify({ run, pass: false, error: "SAFE_HARNESS_ERROR", error_code, stage, real_llm: true }, null, 2),
    );
    await writeFile(join(runDir, "final-answer.txt"), "");
    throw Object.assign(new Error(), { step7Stage: stage, safeErrorCode: error_code });
  } finally {
    removePermission?.();
    await eventIterator?.return?.();
    await eventReader?.catch(() => undefined);
    try { await session?.close?.(); } catch {}
  }
}

const main = async () => {
  await mkdir(artifactsRoot, { recursive: true, mode: 0o700 });
  await mkdir(logsRoot, { recursive: true, mode: 0o700 });
  const initialClient = await connectClient();
  try {
    const config = await initialClient.config.get();
    const provider = {
      id: config.provider?.id,
      model: config.provider?.model,
    };
    if (provider.id !== expectedProvider || provider.model !== expectedModel || config.configured !== true) {
      console.log("REAL_LLM_PROVIDER_NOT_ACTIVE");
      return;
    }
    const packages = await initialClient.packages.list({ profile });
    const plugin = packages.packages.find((item: any) => item.id === "embodied-rescue-plugin");
    const mcpStatus = await initialClient.mcp.servers.status({ profile, serverId: mcpServerId });
    const catalog = await initialClient.mcp.servers.tools.list({ profile, serverId: mcpServerId });
    if (plugin?.actual !== "running" || mcpStatus.connectionState !== "ready" || catalog.items.length !== 8) {
      throw new Error("Plugin or MCP is not ready");
    }

    const results: any[] = [];
    for (let run = 1; run <= 3; run += 1) {
      console.log(`RUN_${run}_STARTED`);
      let client: any;
      try {
        await restartDaemon();
        client = await connectClient();
        const runConfig = await client.config.get();
        if (runConfig.provider?.id !== expectedProvider || runConfig.provider?.model !== expectedModel) {
          throw new Error("provider changed during baseline");
        }
        const result = await runOne(client, run, { id: expectedProvider, model: expectedModel });
        results.push(result);
        console.log(`RUN_${run}_${result.pass ? "PASS" : "FAIL"}`);
      } catch (error) {
        const stage = error && typeof error === "object" && "step7Stage" in error
          ? String((error as { step7Stage?: unknown }).step7Stage)
          : "unknown";
        const errorCode = error && typeof error === "object" && "safeErrorCode" in error
          ? String((error as { safeErrorCode?: unknown }).safeErrorCode)
          : "UNKNOWN";
        results.push({ run, pass: false, real_llm: true, error: "SAFE_HARNESS_ERROR", error_code: errorCode, stage });
        console.log(`RUN_${run}_FAIL_${stage}_${errorCode}`);
      } finally {
        try { await client?.close(); } catch {}
      }
    }
    const summary = {
      total_runs: 3,
      successful_runs: results.filter((result) => result.mission_success).length,
      per_run: results,
      provider: expectedProvider,
      model: expectedModel,
      real_llm: true,
      scripted_tool_sequence: false,
      early_ground_truth_leak_count: results.filter((result) => result.researcher_early_leak).length,
      mission_success_rate: results.filter((result) => result.mission_success).length / 3,
      dynamic_blockage_trigger_rate: results.filter(
        (result) => result.scenario_coverage?.dynamic_blockage_triggered,
      ).length / 3,
      replan_rate_when_triggered: results.filter(
        (result) => result.scenario_coverage?.replan_if_blocked === "PASS",
      ).length / Math.max(
        1,
        results.filter((result) => result.scenario_coverage?.dynamic_blockage_triggered).length,
      ),
      active_perception_rate_when_required: results.filter(
        (result) => result.scenario_coverage?.active_perception_if_required === "PASS",
      ).length / Math.max(
        1,
        results.filter((result) => result.scenario_coverage?.active_perception_required).length,
      ),
      completion_reset_attempts: results.filter((result) => result.attempted_post_completion_reset).length,
      completion_reset_guard_rejections: results.filter(
        (result) => result.post_completion_reset_guard_result === "REJECTED",
      ).length,
      final_report_complete_runs: results.filter(
        (result) => result.final_report_completeness === "PASS",
      ).length,
    };
    await writeFile(join(artifactsRoot, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await initialClient.close();
  }
};

try {
  await main();
} catch {
  console.log("STEP7_BASELINE_HARNESS_FAILED");
  process.exitCode = 1;
}
