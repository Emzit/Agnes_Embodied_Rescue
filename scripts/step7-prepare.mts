import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createClient, memoryJournal } from "../third_party/agnes-harness/packages/sdk/src/index.node.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const home = join(root, ".agh-home-step7");
const profile = "local-dev";
const nodeBin = join(root, "tools/node/bin/node");
const eventLog = join(root, "logs/step7/robot-events-setup.jsonl");
const cliHome = join(root, ".runtime-step7/home");
let prepareStep = "startup";

const waitPackageOperation = async (client: any, receipt: any) => {
  for (;;) {
    const operation = await client.packages.operation.get({ profile, operationId: receipt.operationId });
    if (["failed", "cancelled"].includes(operation.state)) throw new Error(JSON.stringify(operation.lastSafeError));
    if (["completed", "rolled-back"].includes(operation.state)) return operation;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
};

const waitResourceOperation = async (client: any, receipt: any) => {
  for (;;) {
    const operation = await client.resources.operation.get({ profile, operationId: receipt.operationId });
    if (["failed", "cancelled"].includes(operation.state)) throw new Error(JSON.stringify(operation.lastSafeError));
    if (operation.state === "succeeded") return operation;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
};

const main = async () => {
  const owner = JSON.parse(await readFile(join(home, "data/daemon/owner.json"), "utf8"));
  const client: any = createClient({
    transport: { kind: "unix", path: owner.socketPath },
    auth: { kind: "local" },
    journal: memoryJournal(),
  });
  let command = 0;
  const next = (prefix: string) => `${prefix}-${++command}`;
  try {
    prepareStep = "initialize";
    await client.initialize();
    prepareStep = "config.get";
    const config = await client.config.get();
    const clientId = await client.clientId();
    const identity = { profile, clientId };

    const source = { type: "file", ref: "file:./packages/embodied-rescue-plugin" };
    prepareStep = "plugin.inspect";
    const inspected = await waitPackageOperation(
      client,
      await client.packages.inspect({ ...identity, source, commandId: next("plugin-inspect") }),
    );
    assert.ok(inspected.preview);
    prepareStep = "plugin.install";
    await waitPackageOperation(
      client,
      await client.packages.install({
        ...identity,
        source,
        expectedIntegrity: inspected.preview.integrity,
        commandId: next("plugin-install"),
      }),
    );
    prepareStep = "plugin.trust";
    await waitPackageOperation(
      client,
      await client.packages.trust({
        ...identity,
        id: "embodied-rescue-plugin",
        expectedIntegrity: inspected.preview.integrity,
        capabilityHash: inspected.preview.capabilityHash,
        commandId: next("plugin-trust"),
      }),
    );
    prepareStep = "plugin.enable";
    await waitPackageOperation(
      client,
      await client.packages.enable({
        ...identity,
        id: "embodied-rescue-plugin",
        commandId: next("plugin-enable"),
      }),
    );

    const definition = {
      serverId: "robot-mcp",
      displayName: "Mock Robot MCP Step 7",
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
    prepareStep = "mcp.list";
    const existing = await client.mcp.servers.list({ profile });
    const prior = existing.items.find((item: any) => item.serverId === "robot-mcp");
    if (prior) {
      if (prior.desired === "enabled") {
        prepareStep = "mcp.disable-before-remove";
        await waitResourceOperation(
          client,
          await client.mcp.servers.disable({
            profile,
            serverId: "robot-mcp",
            expectedRevision: prior.revision,
            clientId,
            commandId: next("mcp-disable"),
          }),
        );
      }
      const removable = await client.mcp.servers.get({ profile, serverId: "robot-mcp" });
      prepareStep = "mcp.remove";
      await waitResourceOperation(
        client,
        await client.mcp.servers.remove({
          profile,
          serverId: "robot-mcp",
          expectedRevision: removable.revision,
          clientId,
          commandId: next("mcp-remove"),
        }),
      );
    }
    prepareStep = "mcp.create";
    await waitResourceOperation(
      client,
      await client.mcp.servers.create({
        profile,
        definition,
        clientId,
        commandId: next("mcp-create"),
      }),
    );
    let descriptor = await client.mcp.servers.get({ profile, serverId: "robot-mcp" });
    prepareStep = "mcp.trust";
    await waitResourceOperation(
      client,
      await client.mcp.servers.trustSet({
        profile,
        serverId: "robot-mcp",
        expectedRevision: descriptor.revision,
        trust: "trusted",
        clientId,
        commandId: next("mcp-trust"),
      }),
    );
    descriptor = await client.mcp.servers.get({ profile, serverId: "robot-mcp" });
    prepareStep = "mcp.enable";
    await waitResourceOperation(
      client,
      await client.mcp.servers.enable({
        profile,
        serverId: "robot-mcp",
        expectedRevision: descriptor.revision,
        clientId,
        commandId: next("mcp-enable"),
      }),
    );

    let mcpStatus: any;
    prepareStep = "mcp.status";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      mcpStatus = await client.mcp.servers.status({ profile, serverId: "robot-mcp" });
      if (mcpStatus.connectionState === "ready") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    prepareStep = "mcp.tools.list";
    const catalog = await client.mcp.servers.tools.list({ profile, serverId: "robot-mcp" });
    prepareStep = "packages.list";
    const packageRows = await client.packages.list({ profile });
    const pluginRow = packageRows.packages.find((item: any) => item.id === "embodied-rescue-plugin");
    const result = {
      config: {
        configured: Boolean(config.configured),
        revision: config.revision,
        provider_count: (await client.config.providers()).providers?.length ?? null,
      },
      plugin: pluginRow
        ? { id: pluginRow.id, desired: pluginRow.desired, actual: pluginRow.actual, trusted: pluginRow.trusted }
        : null,
      mcp: {
        serverId: "robot-mcp",
        connectionState: mcpStatus?.connectionState,
        toolCount: catalog.items.length,
        tools: catalog.items.map((item: any) => item.name).sort(),
      },
    };
    await writeFile(join(root, "artifacts/step7/setup.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!config.configured) process.exitCode = 2;
  } finally {
    await client.close();
  }
};

try {
  await main();
} catch (error) {
  console.error(`Step 7 prepare failed at ${prepareStep}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
