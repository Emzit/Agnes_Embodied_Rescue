import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serviceRoot = fileURLToPath(new URL("..", import.meta.url));
const serverPath = fileURLToPath(new URL("../src/server.ts", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

const toolNames = [
  "get_robot_state",
  "get_world_state",
  "get_observation",
  "navigate_to",
  "inspect_room",
  "inspect_object",
  "stop_robot",
  "list_known_locations",
];

const jsonResult = (result: { content?: unknown[] }): unknown => {
  const text = (result.content ?? []).find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  );
  assert.ok(text, "MCP result should include JSON text content");
  return JSON.parse(text.text);
};

test("official MCP stdio transport exposes the robot contract", async () => {
  const client = new Client(
    { name: "step5-stdio-test-client", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: serviceRoot,
    env: {
      ...process.env,
      TMPDIR: `${workspaceRoot}/.tmp`,
      XDG_CACHE_HOME: `${workspaceRoot}/.cache`,
    },
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      toolNames,
    );

    const initialState = jsonResult(await client.callTool({ name: "get_robot_state", arguments: {} }));
    assert.equal((initialState as { current_location: string }).current_location, "Start");

    const world = jsonResult(await client.callTool({ name: "get_world_state", arguments: {} }));
    assert.equal(JSON.stringify(world).includes("researcher_01"), false);

    const moved = jsonResult(
      await client.callTool({ name: "navigate_to", arguments: { location: "Room_A" } }),
    );
    assert.deepEqual(moved, { status: "SUCCEEDED", target: "Room_A" });

    const passive = jsonResult(
      await client.callTool({ name: "get_observation", arguments: {} }),
    ) as { object_observations: Array<{ labels: Array<{ confidence: number }> }> };
    assert.equal(passive.object_observations[0].labels[0].confidence, 0.55);

    const active = jsonResult(
      await client.callTool({
        name: "inspect_object",
        arguments: { object_id: "object_17" },
      }),
    ) as { labels: Array<{ name: string; confidence: number }> };
    assert.deepEqual(active.labels[0], {
      name: "fire_extinguisher",
      confidence: 0.94,
    });

    const movedToB = jsonResult(
      await client.callTool({ name: "navigate_to", arguments: { location: "Room_B" } }),
    );
    assert.deepEqual(movedToB, { status: "SUCCEEDED", target: "Room_B" });
    const roomB = jsonResult(
      await client.callTool({ name: "inspect_room", arguments: { location: "Room_B" } }),
    ) as { observations: Array<{ subject: string }> };
    assert.equal(roomB.observations.some((item) => item.subject === "researcher_01"), true);

    const stopped = jsonResult(await client.callTool({ name: "stop_robot", arguments: {} }));
    assert.deepEqual(stopped, { status: "STOPPED" });
  } finally {
    await client.close().catch(() => undefined);
  }
});
