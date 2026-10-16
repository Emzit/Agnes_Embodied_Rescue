import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JsonlBridge } from "../src/transport/jsonl-bridge.ts";
const responder = fileURLToPath(new URL("./fixtures/jsonl-responder.mjs", import.meta.url));

test("JSONL bridge correlates responses despite reordered completion", async () => {
  const bridge = new JsonlBridge(process.execPath, [responder]);
  try {
    const [first, second] = await Promise.all([
      bridge.request("echo", { marker: "first", delay: 30 }),
      bridge.request("echo", { marker: "second", delay: 1 }),
    ]);
    assert.equal(first.marker, "first"); assert.equal(second.marker, "second");
  } finally { await bridge.close(); }
  assert.ok(bridge.child.exitCode !== null || bridge.child.signalCode !== null);
});

test("JSONL bridge rejects unmatched ids by timing out and detects malformed responses", async () => {
  const bridge = new JsonlBridge(process.execPath, [responder]);
  try {
    await assert.rejects(bridge.request("wrong_id", {}, 100), { code: "BRIDGE_TIMEOUT" });
    await assert.rejects(bridge.request("silent", {}, 100), { code: "BRIDGE_TIMEOUT" });
    await assert.rejects(bridge.request("malformed_output"), { code: "BRIDGE_PROTOCOL_ERROR" });
  } finally { await bridge.close(); }
  await assert.rejects(bridge.request("echo"), { code: "BRIDGE_CLOSED" });
});
