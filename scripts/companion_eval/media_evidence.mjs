/** Only observable media evidence; never interpret empty result events as ASR success. */
export function mediaEvidence(report) {
  const captures = report.captures ?? [];
  const captureOk = captures.length === 3 && captures.every(c =>
    Number.isFinite(c.rms) && c.rms > 0.0001 && c.duration_seconds > 5 &&
    c.track_states_after_stop?.length > 0 && c.track_states_after_stop.every(s => s === "ended"));
  const sensevoiceOk = captures.length === 3 && captures.every(c =>
    c.http_status === 200 && !!c.asr?.text?.trim() && c.command === report.expected_command);
  const nativeText = !!report.native?.events?.some(event => event.type === "result" &&
    event.detail?.results?.some(result => result.final && !!result.text?.trim()));
  return { capture_checks_ok: captureOk, separate_sensevoice_checks_ok: sensevoiceOk,
    native_recognition_has_result: nativeText,
    current_diary_chain_status: nativeText ? "HAS_RESULT_REVIEW_TRANSCRIPT_AND_COMMAND" : "NO_NONEMPTY_NATIVE_TRANSCRIPT" };
}
