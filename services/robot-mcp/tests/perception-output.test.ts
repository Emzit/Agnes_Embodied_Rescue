import test from "node:test";
import assert from "node:assert/strict";
import { VISUAL_INSPECTION_PROMPT, DOOR_INSPECTION_PROMPT, VISUAL_SCHEMA_CORRECTION_PROMPT, VISUAL_LABELS, parseVisualDetections } from "../perception/vlm-output.ts";

const door = { label: "door", confidence: .83, bbox: [.2, .1, .6, .95] };

test("Agnes door output survives the exact runtime parser", () => {
  assert.deepEqual(parseVisualDetections(JSON.stringify({ detections: [door] })), [door]);
  assert.match(VISUAL_INSPECTION_PROMPT, /door/);
  assert.match(VISUAL_INSPECTION_PROMPT, /sensor perception subrequest/);
  assert.match(VISUAL_INSPECTION_PROMPT, /not a rescue mission/);
  assert.match(VISUAL_INSPECTION_PROMPT, /including decision_score_candidates/);
  assert.match(VISUAL_INSPECTION_PROMPT, /Fire, orange light, smoke/);
});

test("all previous classes remain valid", () => {
  const detections = VISUAL_LABELS.map(label => ({ ...door, label }));
  assert.deepEqual(parseVisualDetections(JSON.stringify({ detections })), detections);
});

test("flame labels and malformed detections cannot become doors", () => {
  const detections = [
    { ...door, label: "fire" }, { ...door, label: "orange" }, { ...door, label: "door_closed" },
    { ...door, confidence: 1.1 }, { ...door, confidence: "0.9" },
    { ...door, bbox: [.8, .1, .2, .9] }, { ...door, bbox: [0, 0, 1, 1.2] },
    null, 4, { label: "door" },
  ];
  assert.deepEqual(parseVisualDetections(JSON.stringify({ detections })), []);
});

test("JSON inside a text fence and quoted braces is parsed correctly", () => {
  const text = "image reply:\\n" + JSON.stringify({ note: "ignore braces { and }", detections: [door] }) + "\\nend";
  assert.deepEqual(parseVisualDetections(text), [door]);
});

test("the final valid detection object is selected", () => {
  const text = JSON.stringify({ detections: [] }) + "\\n" + JSON.stringify({ detections: [door] });
  assert.deepEqual(parseVisualDetections(text), [door]);
});

test("empty visual evidence stays empty and missing JSON fails explicitly", () => {
  assert.deepEqual(parseVisualDetections('{"detections":[]}'), []);
  assert.throws(() => parseVisualDetections('{"door":true}'), /VLM_INVALID_OUTPUT/);
  assert.throws(() => parseVisualDetections("cannot see a door"), /VLM_INVALID_OUTPUT/);
});


test("a complete top-level JSON array preserves actual detection content", () => {
  const uncertainDoor = { ...door, confidence: .35 };
  assert.deepEqual(parseVisualDetections(JSON.stringify([uncertainDoor])), [uncertainDoor]);
  assert.deepEqual(parseVisualDetections("[]"), []);
});

test("top-level arrays use the same strict filter and partial arrays are rejected", () => {
  const invalid = [
    null, "door", 42, { label: "door" }, { ...door, label: "fire" },
    { ...door, confidence: -1 }, { ...door, bbox: [0, .8, 1, .2] },
  ];
  assert.deepEqual(parseVisualDetections(JSON.stringify(invalid)), []);
  assert.throws(() => parseVisualDetections("prefix " + JSON.stringify([door]) + " suffix"), /VLM_INVALID_OUTPUT/);
});


test("missing detections remains an error and a bounded correction contract cannot manufacture absent people", () => {
  assert.throws(() => parseVisualDetections("{}"), /VLM_INVALID_OUTPUT/);
  assert.throws(() => parseVisualDetections("```json\\n{}\\n```"), /VLM_INVALID_OUTPUT/);
  assert.deepEqual(parseVisualDetections('{"detections":[]}'), []);
  assert.deepEqual(parseVisualDetections('```json\\n{"detections":[]}\\n```'), []);
  for (const prompt of [VISUAL_INSPECTION_PROMPT, DOOR_INSPECTION_PROMPT, VISUAL_SCHEMA_CORRECTION_PROMPT])
    assert.ok(prompt.includes('{"detections":[]}'), "the model receives a valid empty-list JSON example without extra escaping");
  assert.match(VISUAL_SCHEMA_CORRECTION_PROMPT, /identical sensor pixels/);
  assert.match(VISUAL_SCHEMA_CORRECTION_PROMPT, /invalid previous answer as evidence of absence/);
});
