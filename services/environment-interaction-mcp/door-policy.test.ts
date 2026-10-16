import test from "node:test";
import assert from "node:assert/strict";
import { doorState, nearDoor, visibleAgnesDoors, doorInspectionFailure } from "./door-policy.ts";

const camera = { available: true };
const genuine = { label: "door", evidence: { method: "vlm", provider: "agnes-ai", frame_sha256: "a".repeat(64) } };

test("fire-colored CV blobs cannot authorize a door operation", () => {
  assert.deepEqual(visibleAgnesDoors({ camera, semantic_objects: [
    { label: "door", evidence: { method: "cv_color_contour", frame_sha256: "b".repeat(64) } },
    { ...genuine, label: "fire" },
  ] }), []);
});

test("only frame-backed Agnes door detections are accepted", () => {
  assert.deepEqual(visibleAgnesDoors({ camera, semantic_objects: [genuine] }), [genuine]);
  assert.deepEqual(visibleAgnesDoors({ camera: { available: false }, semantic_objects: [genuine] }), []);
  assert.deepEqual(visibleAgnesDoors({ camera, semantic_objects: [
    { label: "door" }, { ...genuine, evidence: { ...genuine.evidence, frame_sha256: "" } },
    { ...genuine, evidence: { ...genuine.evidence, provider: "other" } },
  ] }), []);
});

test("missing Gazebo pose is unknown and a partially swung door is not open", () => {
  assert.equal(doorState({}, {}), "UNKNOWN");
  assert.equal(doorState({}, { yaw_rad: null }), "UNKNOWN");
  assert.equal(doorState({}, { yaw_rad: .6 }), "CLOSED");
  assert.equal(doorState({}, { yaw_rad: Math.PI / 2 }), "OPEN");
});

test("orientation wrapping does not confuse closed with open", () => {
  assert.equal(doorState({ nominal_orientation: Math.PI }, { yaw_rad: -Math.PI }), "CLOSED");
  assert.equal(doorState({ nominal_orientation: -Math.PI / 2 }, { yaw_rad: 0 }), "OPEN");
});

test("door proximity remains bounded and missing poses fail closed", () => {
  const door = { at: [4.5, -6], interaction_pose: { x: 3.4, y: -6 } };
  assert.equal(nearDoor({ x: 3.4, y: -6 }, door), true);
  assert.equal(nearDoor({ x: 0, y: -6 }, door), false);
  assert.equal(nearDoor(null, door), false);
  assert.equal(nearDoor({ x: NaN, y: -6 }, door), false);
  assert.equal(nearDoor({ x: 4.5, y: -6 }, { at: [4.5, -6] }), true);
});

test("failed camera, failed Agnes inference and negative image have distinct failure codes", () => {
  assert.equal(doorInspectionFailure({camera:{available:false}}, true, "CLOSED"), "CAMERA_UNAVAILABLE");
  const unavailable = {camera, perception_status:"PERCEPTION_UNAVAILABLE", semantic_objects:[]};
  assert.equal(doorInspectionFailure(unavailable, true, "CLOSED"), "DOOR_PERCEPTION_UNAVAILABLE");
  const noDoor = {camera, perception_status:"AVAILABLE", semantic_objects:[{...genuine,label:"person"}]};
  assert.equal(doorInspectionFailure(noDoor, true, "CLOSED"), "DOOR_NOT_VISUALLY_OBSERVED");
  const seen = {...noDoor, semantic_objects:[genuine]};
  assert.equal(doorInspectionFailure(seen, false, "CLOSED"), "DOOR_OUT_OF_REACH");
  assert.equal(doorInspectionFailure(seen, true, "UNKNOWN"), "PANEL_POSE_UNAVAILABLE");
  assert.equal(doorInspectionFailure(seen, true, "CLOSED"), null);
  // A stale cached detection cannot override an unsuccessful inference.
  assert.equal(doorInspectionFailure({...seen,perception_status:"PERCEPTION_UNAVAILABLE"},true,"CLOSED"), "DOOR_PERCEPTION_UNAVAILABLE");
});
