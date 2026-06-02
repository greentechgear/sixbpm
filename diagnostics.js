import { calculateSyncScore, rounded } from "./state.js";

export function createLogger(els, state) {
  return function log(message) {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const line = `[${stamp}] ${message}`;
    if (els.sessionLog) {
      els.sessionLog.textContent += `${line}\n`;
      els.sessionLog.scrollTop = els.sessionLog.scrollHeight;
    }
    if (state.diagnostics) {
      state.diagnostics.log.push(line);
      state.diagnostics.log = state.diagnostics.log.slice(-220);
    }
  };
}

export function finalizeDiagnostics(state, status, userBpmInfo) {
  state.diagnostics.ended_at = new Date().toISOString();
  state.diagnostics.status = status;
  state.diagnostics.settings_final = state.sessionSettings || {};
  state.diagnostics.final_target_bpm = rounded(state.targetBpm);
  const bpm = userBpmInfo();
  state.diagnostics.final_user_bpm = rounded(bpm.value);
  state.diagnostics.final_user_bpm_source = bpm.source;
  state.diagnostics.sync_quality_score = rounded(calculateSyncScore(state.syncSamples));
  state.diagnostics.calibration_peak_count = state.breathDetector.calibrationPeakCount || state.diagnostics.calibration_peak_count;
  state.diagnostics.pacing_peak_count = state.breathDetector.pacingPeakCount || state.diagnostics.pacing_peak_count;
}

export function buildReport(state, sessionLogText, userBpmInfo, calibrationRemainingMs) {
  const elapsedMs = state.sessionStartMs ? Math.round(performance.now() - state.sessionStartMs) : null;
  return {
    diagnostics: state.diagnostics,
    current: {
      phase: state.phase,
      elapsed_ms: elapsedMs,
      calibration_remaining_ms: calibrationRemainingMs,
      report_note: reportNote(state.phase, elapsedMs, calibrationRemainingMs),
      target_bpm: rounded(state.targetBpm),
      user_bpm: rounded(userBpmInfo().value),
      peaks: state.breathDetector.peaks.map((t) => Math.round(t - state.sessionStartMs)).slice(-12),
      session_log_text: sessionLogText
    }
  };
}

export function reportNote(phase, elapsedMs, calibrationRemainingMs) {
  if (phase === "calibrating") {
    return `Still calibrating. Wait ${Math.ceil(Math.max(0, calibrationRemainingMs || 0) / 1000)} more seconds before judging breath detection.`;
  }
  if (phase === "pacing" && elapsedMs !== null && elapsedMs < 90000) {
    return "Pacing has started. For a useful report, let it run another minute if possible.";
  }
  return "Report captured.";
}
