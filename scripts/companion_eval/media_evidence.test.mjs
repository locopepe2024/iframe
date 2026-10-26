import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaEvidence } from "./media_evidence.mjs";

function sample() {
  return { expected_command: "stop", captures: Array.from({ length: 3 }, () => ({
    rms: 0.1, duration_seconds: 6.4, track_states_after_stop: ["ended"], http_status: 200,
    asr: { text: "停止。" }, command: "stop",
  })), native: { events: [{ type: "result", detail: { results: [{ final: true, text: "" }] } }] } };
}
test("nonempty PCM and remote ASR do not prove native diary recognition", () => {
  const result = mediaEvidence(sample());
  assert.equal(result.capture_checks_ok, true);
  assert.equal(result.separate_sensevoice_checks_ok, true);
  assert.equal(result.native_recognition_has_result, false);
});
test("interim text cannot stand in for a final transcript", () => {
  const input = sample(); input.native.events[0].detail.results = [{ final: false, text: "停止" }];
  assert.equal(mediaEvidence(input).native_recognition_has_result, false);
  input.native.events[0].detail.results[0].final = true;
  assert.equal(mediaEvidence(input).native_recognition_has_result, true);
});
test("429, silence, empty tracks and missing captures remain failures", () => {
  let input = sample(); input.captures[0].http_status = 429;
  assert.equal(mediaEvidence(input).separate_sensevoice_checks_ok, false);
  input = sample(); input.captures[0].rms = 0;
  assert.equal(mediaEvidence(input).capture_checks_ok, false);
  input = sample(); input.captures[0].track_states_after_stop = [];
  assert.equal(mediaEvidence(input).capture_checks_ok, false);
  assert.equal(mediaEvidence({ captures: [] }).separate_sensevoice_checks_ok, false);
});
