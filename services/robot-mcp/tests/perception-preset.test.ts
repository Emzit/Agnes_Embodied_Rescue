import test from "node:test";
import assert from "node:assert/strict";
import { resolvePreset } from "../../../third_party/agnes-harness/packages/host/src/index.ts";
import { presets as base } from "../../../third_party/agnes-harness/packages/base/src/index.ts";
import { presets as product } from "../../../third_party/agnes-harness/packages/code/src/index.ts";
import { presets as image } from "../../../packages/embodied-rescue-plugin/src/sensor-image-preset.mjs";

test("sensor-image resolves through the real Host inheritance and preserves Agnes deployment routing and approvals", () => {
  const docs = { ...base, ...product, ...image };
  const standard = resolvePreset("standard", docs);
  const sensor = resolvePreset("sensor-image", docs);
  assert.deepEqual(sensor.chain, ["base", "standard", "sensor-image"]);
  assert.equal(sensor.view.disclosure, "none");
  assert.deepEqual(sensor.view.model.promptSections, []);
  assert.deepEqual(sensor.view.model.route, standard.view.model.route);
  assert.deepEqual(sensor.view.model.id, standard.view.model.id);
  assert.deepEqual(sensor.view.approval, standard.view.approval);
  assert.equal(sensor.view.budget.maxSteps, 1);
  assert.equal(sensor.view.model.retry.maxAttempts, 1);
  assert.equal(sensor.view.model.timeoutMs, 30000);
  assert.equal(sensor.view.model.maxTokens, 2048);
  assert.equal(standard.view.disclosure, "standard");
});

test("a missing sensor-image preset fails closed rather than resolving standard", () => {
  assert.throws(() => resolvePreset("sensor-image", {...base,...product}), /not provided/);
});


test("recorded-demo resolves from the production package loader while preserving model, approval, sandbox and verifier policy", async () => {
  const { createLoader } = await import("../../../third_party/agnes-harness/packages/host/src/index.ts");
  const { createJitiPackageLoader } = await import("../../../third_party/agnes-harness/packages/host/src/assemble/packages.ts");
  const { fileURLToPath } = await import("node:url");
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const artifactRoot = join(root, "artifacts", "tests");
  mkdirSync(artifactRoot, { recursive: true });
  const cache = mkdtempSync(join(artifactRoot, "recorded-demo-loader-"));
  try {
    const importer = createLoader({ cacheDir: cache, hostRoot: join(root, "third_party", "agnes-harness"), agnesVersion: "recorded-demo-test" });
    const loader = createJitiPackageLoader(importer);
    const plugin = await loader.importPackage("embodied-rescue-plugin", join(root, "packages", "embodied-rescue-plugin"));
    assert.ok(plugin.plugins?.length);
    assert.ok(plugin.presets?.["sensor-image"]);
    const docs = { ...base, ...product, ...plugin.presets };
    const standard = resolvePreset("standard", docs);
    const demo = resolvePreset("recorded-demo", docs);
    assert.deepEqual(demo.chain, ["base", "standard", "recorded-demo"]);
    assert.deepEqual(demo.doc.surfaces, ["sdk", "daemon"]);
    assert.equal(demo.doc.completion_gate.enabled, false);
    assert.equal(demo.doc.harness.auto_refine.enabled, false);
    assert.equal(demo.doc.harness.auto_refine.global_needs_human, standard.doc.harness.auto_refine.global_needs_human);
    assert.deepEqual(demo.view.model, standard.view.model);
    assert.deepEqual(demo.view.approval, standard.view.approval);
    assert.deepEqual(demo.view.sandbox, standard.view.sandbox);
    assert.deepEqual(demo.view.verifier, standard.view.verifier);
    assert.deepEqual(demo.view.tools, standard.view.tools);
    assert.equal(demo.view.disclosure, standard.view.disclosure);
    assert.equal(standard.doc.completion_gate.enabled, true);
    assert.equal(standard.doc.harness.auto_refine.enabled, true);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("missing recorded-demo fails closed and cannot silently become standard", () => {
  assert.throws(() => resolvePreset("recorded-demo", { ...base, ...product }), /not provided/);
});


test("an idle native steer is retained in the ledger and reaches the first inference before the simple goal can execute", async () => {
  const { actor, fakeProvider, textTurn, openSession } = await import("../../../third_party/agnes-harness/packages/core/testkit/index.ts");
  const background = "Only inspect Start and write world_memory_update with robot_location and last_observation; do not use current_plan.";
  const goal = "请找到待救援人员。";
  const provider = fakeProvider([textTurn("Current stage observed; waiting for next stage.")]);
  const { session, log } = await openSession({ provider });
  try {
    await session.enqueue("next-step", { content: [{ type: "text", text: background }], actor, kind: "steer" });
    assert.equal(provider.calls, 0);
    assert.equal(session.op(), null);
    await session.enqueue("next-turn", { content: [{ type: "text", text: goal }], actor, kind: "prompt" });
    assert.equal((await session.run({ until: "turn-end", signal: new AbortController().signal })).reason, "completed");
    assert.equal(provider.calls, 1);
    const firstRequest = JSON.stringify(provider.requests[0]);
    assert.ok(firstRequest.includes(background), "first inference must already contain the stage constraints");
    assert.ok(firstRequest.includes(goal), "simple goal remains an actual prompt");
    const messages = await log.scan({ type: "user/message", limit: 10 });
    assert.deepEqual(messages.map((row) => row.data.kind), ["prompt", "steer"]);
    assert.deepEqual(messages.map((row) => row.data.content[0].text), [goal, background]);
    const request = (await log.scan({ type: "request/sent", limit: 10 }))[0];
    assert.ok(messages.every((row) => row.seq < request.seq), "both native messages precede the first sent request");
    assert.deepEqual(session.latest("inbox"), { items: [] });
  } finally {
    await session.close();
  }
});
