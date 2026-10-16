import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { createClient, memoryJournal } from "../third_party/agnes-harness/packages/sdk/src/index.node.ts";
import { startProviderFixture } from "../third_party/agnes-harness/tools/acceptance/provider-fixture.ts";

const execFileAsync = promisify(execFile);
const root = resolve(new URL("..", import.meta.url).pathname);
const nodeBin = join(root, "tools/node/bin/node");
const cliEntry = join(root, "third_party/agnes-harness/packages/cli/dist/local/agnes.mjs");
const home = join(root, ".agh-home-step6");
const runtime = join(root, ".runtime-step6");
const tmp = join(root, ".tmp");
const cache = join(root, ".cache");
const logs = join(root, "logs/step6");
const artifacts = join(root, "artifacts/step6");
const profile = "local-dev";
const eventLog = join(logs, "robot-events.jsonl");
let currentStep = "startup";

const pluginTools = [
  "mission_reset",
  "mission_get_state",
  "world_memory_get",
  "world_memory_update",
  "decision_score_candidates",
];
const mcpTools = [
  "get_robot_state",
  "get_world_state",
  "get_observation",
  "navigate_to",
  "inspect_room",
  "inspect_object",
  "stop_robot",
  "list_known_locations",
];

const env = {
  PATH: `${join(root, "tools/node/bin")}:${process.env.PATH ?? ""}`,
  HOME: join(runtime, "home"),
  AGH_HOME: home,
  AGNES_PROFILE: profile,
  AGNES_MCP_STDIO_ALLOWLIST: nodeBin,
  TMPDIR: tmp,
  XDG_CACHE_HOME: cache,
  XDG_CONFIG_HOME: join(runtime, "config"),
  XDG_DATA_HOME: join(runtime, "data"),
  COREPACK_HOME: join(root, ".corepack-home"),
  NODE_NO_WARNINGS: "1",
  LANG: process.env.LANG ?? "C.UTF-8",
};

const commandLog: string[] = [];

const runCli = async (args: string[]) => {
  const result = await execFileAsync(nodeBin, [cliEntry, ...args], {
    cwd: root,
    env,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  commandLog.push(`$ agh ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result;
};

const waitPackageOperation = async (client: any, receipt: any) => {
  for (;;) {
    const operation = await client.packages.operation.get({
      profile,
      operationId: receipt.operationId,
    });
    if (["failed", "cancelled"].includes(operation.state)) {
      throw new Error(`package operation ${operation.state}: ${JSON.stringify(operation.lastSafeError)}`);
    }
    if (["completed", "rolled-back"].includes(operation.state)) return operation;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
};

const waitResourceOperation = async (client: any, receipt: any) => {
  for (;;) {
    const operation = await client.resources.operation.get({
      profile,
      operationId: receipt.operationId,
    });
    if (["failed", "cancelled"].includes(operation.state)) {
      throw new Error(`resource operation ${operation.state}: ${JSON.stringify(operation.lastSafeError)}`);
    }
    if (operation.state === "succeeded") return operation;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
};

const commandId = (prefix: string, n: number): string => `${prefix}-${n}`;

const mcpToolPrefix = (serverId: string): string => {
  const slug = serverId
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "server";
  const hash = createHash("sha256").update(serverId, "utf8").digest("hex").slice(0, 8);
  return `mcp_${slug}_${hash}_`;
};

const safeArgs = (args: unknown): unknown => {
  if (!args || typeof args !== "object") return args;
  const value = structuredClone(args) as Record<string, unknown>;
  if ("world_state" in value) value.world_state = "structured-world-state";
  return value;
};

const summarizeStructured = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of [
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
    "observations",
    "known_objects",
    "current_location",
    "locations",
    "routes",
    "known_locations",
  ]) {
    if (key in source) summary[key] = source[key];
  }
  if (source.world_memory && typeof source.world_memory === "object") {
    summary.world_memory = summarizeStructured(source.world_memory);
  }
  return summary;
};

const main = async () => {
  await mkdir(join(home, "profiles", profile), { recursive: true, mode: 0o700 });
  await mkdir(join(runtime, "home"), { recursive: true, mode: 0o700 });
  await mkdir(join(runtime, "config"), { recursive: true, mode: 0o700 });
  await mkdir(join(runtime, "data"), { recursive: true, mode: 0o700 });
  await mkdir(tmp, { recursive: true });
  await mkdir(cache, { recursive: true });
  await mkdir(logs, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    join(home, "profiles", profile, "profile.yaml"),
    [
      `name: ${profile}`,
      "computerUse:",
      "  enabled: false",
      "policy:",
      "  capabilityCeiling: [tools, hooks, slots, events, resources, ui, services, network, network.publicRead, tools.invoke, artifacts, subagent]",
      "",
    ].join("\n"),
  );

  let provider: Awaited<ReturnType<typeof startProviderFixture>>;
  let client: any;
  let session: any;
  let providerClosed = false;
  let daemonStopped = false;

  try {
    currentStep = "daemon startup";
    await runCli(["sessions", "--json"]);
    const owner = JSON.parse(await readFile(join(home, "data/daemon/owner.json"), "utf8"));
    client = createClient({
      transport: { kind: "unix", path: owner.socketPath },
      auth: { kind: "local" },
      journal: memoryJournal(),
    });
    await client.initialize();

    currentStep = "provider configuration";
    const catalogue = await client.config.test({ providerId: "deepseek" });
    const model = catalogue.models[0]?.id;
    assert.ok(model, "DeepSeek provider catalogue must expose a model");
    provider = await startProviderFixture(
      "Deterministic Step 6 loopback completion.",
      undefined,
      model,
    );
    await client.config.save({
      providerId: "deepseek",
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model,
      expectedRevision: 0,
    });

    const clientId = await client.clientId();
    let commandNumber = 0;
    const nextCommand = (prefix: string) => commandId(prefix, ++commandNumber);
    const packageIdentity = { profile, clientId };

    currentStep = "plugin install trust enable";
    const packageSource = { type: "file", ref: "file:./packages/embodied-rescue-plugin" };
    const inspected = await waitPackageOperation(
      client,
      await client.packages.inspect({
        ...packageIdentity,
        source: packageSource,
        commandId: nextCommand("plugin-inspect"),
      }),
    );
    assert.ok(inspected.preview, "plugin inspect must return a preview");
    await waitPackageOperation(
      client,
      await client.packages.install({
        ...packageIdentity,
        source: packageSource,
        expectedIntegrity: inspected.preview.integrity,
        commandId: nextCommand("plugin-install"),
      }),
    );
    await waitPackageOperation(
      client,
      await client.packages.trust({
        ...packageIdentity,
        id: "embodied-rescue-plugin",
        expectedIntegrity: inspected.preview.integrity,
        capabilityHash: inspected.preview.capabilityHash,
        commandId: nextCommand("plugin-trust"),
      }),
    );
    await waitPackageOperation(
      client,
      await client.packages.enable({
        ...packageIdentity,
        id: "embodied-rescue-plugin",
        commandId: nextCommand("plugin-enable"),
      }),
    );

    currentStep = "robot MCP create trust enable";
    const mcpDefinition = {
      serverId: "robot-mcp",
      displayName: "Mock Robot MCP",
      transport: {
        kind: "stdio",
        executable: nodeBin,
        args: [
          join(root, "services/robot-mcp/src/server.ts"),
          "--scenario",
          "dynamic_rescue",
          "--event-log",
          eventLog,
        ],
      },
      secretBinding: { kind: "none" },
    };
    await waitResourceOperation(
      client,
      await client.mcp.servers.create({
        profile,
        definition: mcpDefinition,
        clientId,
        commandId: nextCommand("mcp-create"),
      }),
    );
    let mcpDescriptor = await client.mcp.servers.get({ profile, serverId: "robot-mcp" });
    await waitResourceOperation(
      client,
      await client.mcp.servers.trustSet({
        profile,
        serverId: "robot-mcp",
        expectedRevision: mcpDescriptor.revision,
        trust: "trusted",
        clientId,
        commandId: nextCommand("mcp-trust"),
      }),
    );
    mcpDescriptor = await client.mcp.servers.get({ profile, serverId: "robot-mcp" });
    await waitResourceOperation(
      client,
      await client.mcp.servers.enable({
        profile,
        serverId: "robot-mcp",
        expectedRevision: mcpDescriptor.revision,
        clientId,
        commandId: nextCommand("mcp-enable"),
      }),
    );

    let mcpStatus: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      mcpStatus = await client.mcp.servers.status({ profile, serverId: "robot-mcp" });
      if (mcpStatus.connectionState === "ready") break;
      if (attempt === 10 && mcpStatus.connectionState === "disabled") {
        const current = await client.mcp.servers.get({ profile, serverId: "robot-mcp" });
        await waitResourceOperation(
          client,
          await client.mcp.servers.reconnect({
            profile,
            serverId: "robot-mcp",
            expectedRevision: current.revision,
            clientId,
            commandId: nextCommand("mcp-reconnect"),
          }),
        );
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.equal(mcpStatus.connectionState, "ready");
    const catalog = await client.mcp.servers.tools.list({ profile, serverId: "robot-mcp" });
    assert.deepEqual(
      catalog.items.map((item: { name: string }) => item.name).sort(),
      [...mcpTools].sort(),
    );
    const mcpPrefix = mcpToolPrefix("robot-mcp");
    const mcp = (name: string) => `${mcpPrefix}${name}`;
    const candidates = [
      {
        id: "route_via_room_c",
        type: "navigate",
        target: "Room_C",
        features: { safety: 0.9, success: 0.9, cost: 0.6, information_gain: 0.3 },
      },
      {
        id: "wait",
        type: "wait",
        features: { safety: 1, success: 0.1, cost: 0.1, information_gain: 0 },
      },
      {
        id: "retry_blocked_route",
        type: "navigate",
        target: "Room_B",
        features: { safety: 0.3, success: 0.4, cost: 0.5, information_gain: 0.2 },
      },
    ];
    const worldMemoryForDecision = {
      robot_location: "Room_A",
      searched_rooms: ["Room_A"],
      blocked_routes: [
        { from: "Room_A", to: "Room_B", reason: "PATH_BLOCKED", obstacle_id: "cabinet_01" },
      ],
      known_objects: [],
      detected_hazards: [],
      target_status: "not_found",
      action_history: [],
      replans_count: 1,
      active_perception_count: 1,
      last_observation: "object:object_17",
      current_plan: [],
    };
    const queue = (name: string, args: Record<string, unknown> = {}) =>
      provider.queueTool({ name, args });

    queue("mission_reset");
    queue("mission_get_state");
    queue(mcp("get_world_state"));
    queue(mcp("get_robot_state"));
    queue(mcp("navigate_to"), { location: "Room_A" });
    queue(mcp("inspect_room"), { location: "Room_A" });
    queue(mcp("get_observation"));
    queue(mcp("inspect_object"), { object_id: "object_17" });
    queue("world_memory_update", {
      searched_room: "Room_A",
      known_object: {
        object_id: "object_17",
        location: "Room_A",
        labels: [{ name: "fire_extinguisher", confidence: 0.94 }],
      },
      active_perception: true,
      last_observation: "object:object_17",
    });
    queue(mcp("get_world_state"));
    queue("world_memory_get");
    queue(mcp("navigate_to"), { location: "Room_B" });
    queue(mcp("get_world_state"));
    queue("world_memory_update", {
      blocked_route: {
        from: "Room_A",
        to: "Room_B",
        reason: "PATH_BLOCKED",
        obstacle_id: "cabinet_01",
      },
      replan: true,
    });
    queue("decision_score_candidates", {
      goal: "find researcher_01",
      world_state: worldMemoryForDecision,
      candidates,
    });
    queue(mcp("navigate_to"), { location: "Room_C" });
    queue(mcp("navigate_to"), { location: "Side_Corridor" });
    queue(mcp("navigate_to"), { location: "Room_B" });
    queue(mcp("inspect_room"), { location: "Room_B" });
    queue("world_memory_update", {
      robot_location: "Room_B",
      target_status: "FOUND",
      last_observation: "room:Room_B",
    });
    queue("mission_get_state");

    currentStep = "real session prompt";
    session = await client.session.new({ cwd: root });
    await session.attach();
    const approvals: unknown[] = [];
    const offPermission = session.onPermissionRequest(async (request: any) => {
      const name = request.toolCall?._meta?.["ai.agnes.harness"]?.tool;
      approvals.push({ name, options: request.options?.map((o: any) => o.kind) });
      const permitted = pluginTools.includes(name)
        || mcpTools.includes(name)
        || mcpTools.some((tool) => mcp(tool) === name);
      if (!permitted) {
        const reject = request.options.find((option: any) => option.kind === "reject_once");
        return { optionId: reject?.optionId ?? request.options[0].optionId };
      }
      const allow = request.options.find((option: any) => option.kind === "allow_once");
      if (!allow) throw new Error(`expected allow_once for ${name}`);
      return { optionId: allow.optionId };
    });
    const iterator = session.events()[Symbol.asyncIterator]();
    const events: any[] = [];
    const eventReader = (async () => {
      for (;;) {
        const item = await iterator.next();
        if (item.done) return;
        events.push(item.value);
      }
    })();
    const turn = await session.prompt(
      "请使用 $embodied-rescue 方法进入实验室寻找失联研究员。搜索必要区域；如果路线受阻，根据当前世界状态重新选择安全可行的路线。遇到低置信度环境目标时主动进一步检查。找到研究员后，返回任务状态、已搜索区域、阻塞路线、重规划次数和主动感知次数。",
      { signal: AbortSignal.timeout(120_000), titleLocale: "zh-CN" },
    );
    await iterator.return?.();
    await eventReader;
    offPermission();
    assert.equal(turn.reason, "completed");
    const skillContributionLoaded = provider.requests.some((request) =>
      JSON.stringify(request.messages).includes("<active_skill>") &&
      JSON.stringify(request.messages).includes("embodied-rescue"),
    );
    assert.equal(skillContributionLoaded, true, "runtime Skill contribution was not loaded into the real prompt");

    const calls = events.filter((event) => event.type === "tool/call");
    const results = events.filter((event) => event.type === "tool/result");
    const toolTrace: any[] = [];
    for (const event of calls) {
      const resultEvent = results.find((candidate) => candidate.data?.toolUseId === event.data?.toolUseId);
      const detail = await session.readToolDetail(event.seq, resultEvent?.seq);
      const name = detail.call.name;
      const domain = pluginTools.includes(name) ? "plugin" : name.startsWith(mcpPrefix) ? "mcp" : "unknown";
      let structured = detail.result?.structured;
      if (structured === undefined) {
        const textBlock = detail.result?.content?.find((block: any) => block.type === "text");
        if (textBlock?.text) {
          try { structured = JSON.parse(textBlock.text); } catch {}
        }
      }
      if (name.startsWith(mcpPrefix) && typeof structured === "object" && structured !== null) {
        const raw = structured as Record<string, unknown>;
        if ("items" in raw && Array.isArray(raw.items)) structured = { items: raw.items };
      }
      toolTrace.push({
        seq: event.seq,
        result_seq: resultEvent?.seq,
        domain,
        tool: name,
        args: safeArgs(detail.call.args),
        result: structured === undefined
          ? { content: detail.result?.content ?? [] }
          : summarizeStructured(structured),
        is_error: detail.result?.isError ?? null,
      });
    }

    const lastMission = [...toolTrace].reverse().find((item) => item.tool === "mission_get_state");
    const finalMissionState = lastMission?.result;
    const allNames = toolTrace.map((item) => item.tool);
    assert.deepEqual(allNames.filter((name) => pluginTools.includes(name)), [
      "mission_reset",
      "mission_get_state",
      "world_memory_update",
      "world_memory_get",
      "world_memory_update",
      "decision_score_candidates",
      "world_memory_update",
      "mission_get_state",
    ]);
    assert.equal(toolTrace.filter((item) => item.domain === "mcp").length, 13);
    const debug = JSON.stringify({ toolTrace, approvals });
    assert.equal(toolTrace.some((item) => item.result?.reason === "PATH_BLOCKED"), true, debug);
    assert.equal(toolTrace.some((item) => item.result?.provider_name === "fallback"), true, debug);
    assert.equal(toolTrace.some((item) => item.result?.selected_action?.id === "route_via_room_c"), true, debug);
    assert.equal(toolTrace.some((item) => item.tool === mcp("inspect_room") && item.args.location === "Room_B" && item.result?.observations?.some((o: any) => o.subject === "researcher_01")), true, debug);

    const eventLines = (await readFile(eventLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(eventLines, [{ event: "block_corridor_a", obstacle_id: "cabinet_01", route: "Corridor_A" }]);
    const worldChecks = toolTrace.filter((item) => item.tool === mcp("get_world_state"));
    assert.equal(worldChecks.length, 3);
    assert.equal(worldChecks.every((item) => !JSON.stringify(item.result).includes("researcher_01")), true);
    const providerSummary = provider.requests.map((request, index) => ({
      index: index + 1,
      model: request.model,
      advertised_tool_count: request.tools.length,
      advertised_tools: request.tools,
      assistant_tool_calls: request.messages
        .filter((message: any) => message.role === "assistant" && Array.isArray(message.toolCalls))
        .flatMap((message: any) => message.toolCalls.map((call: any) => call.name)),
      returned_tool_result_count: request.messages.filter((message: any) => message.role === "tool_result").length,
    }));

    await writeFile(join(artifacts, "tool-trace.json"), JSON.stringify({ sessionId: session.id, trace: toolTrace }, null, 2));
    await writeFile(join(artifacts, "final-mission-state.json"), JSON.stringify(finalMissionState, null, 2));
    await writeFile(join(artifacts, "provider-requests-summary.json"), JSON.stringify(providerSummary, null, 2));
    await writeFile(
      join(artifacts, "acceptance-result.json"),
      JSON.stringify(
        {
          sessionId: session.id,
          turn,
          approvals: approvals.length,
          plugin_tools: pluginTools,
          mcp_tools: mcpTools,
          skill_contribution: { name: "embodied-rescue", loaded_into_prompt: skillContributionLoaded },
          mcp_tool_prefix: mcpPrefix,
          eventLog: eventLines,
          tool_call_count: toolTrace.length,
          provider_name: toolTrace.find((item) => item.tool === "decision_score_candidates")?.result?.provider_name,
          selected_action: toolTrace.find((item) => item.tool === "decision_score_candidates")?.result?.selected_action?.id,
          final_mission_state: finalMissionState,
          researcher_call_index: toolTrace.findIndex((item) => item.tool === mcp("inspect_room") && item.args.location === "Room_B"),
          ground_truth_leak_checks: toolTrace
            .filter((item) => item.tool === mcp("get_world_state"))
            .map((item) => ({ seq: item.seq, contains_researcher: JSON.stringify(item.result).includes("researcher_01") })),
        },
        null,
        2,
      ),
    );
    await writeFile(join(logs, "acceptance-cli.log"), `${commandLog.join("\n\n")}\n`);
    console.log(JSON.stringify({ sessionId: session.id, toolCalls: toolTrace.length, mcpStatus, finalMissionState }, null, 2));
  } finally {
    if (session) {
      try { await session.close?.(); } catch {}
    }
    if (client) {
      try { await client.close(); } catch {}
    }
    try {
      await runCli(["daemon", "stop"]);
      daemonStopped = true;
    } catch (error) {
      commandLog.push(`daemon stop failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!providerClosed && provider) {
      await provider.close();
      providerClosed = true;
    }
    await writeFile(join(logs, "acceptance-cli.log"), `${commandLog.join("\n\n")}\n`);
    if (!daemonStopped) throw new Error("Step 6 daemon did not stop cleanly");
  }
};

try {
  await main();
} catch (error) {
  console.error(`Step 6 failed at ${currentStep}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
