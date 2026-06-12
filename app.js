import {
  APP_VERSION,
  LIMITS,
  TIMING,
  PRESETS,
  applyPreset,
  calculateSyncScore,
  clamp,
  createAppState,
  createDiagnostics,
  cycleTiming,
  descentDecision,
  humming478Timing,
  inferPreset,
  rounded,
  sensorFallbackDecision,
  syncWindowMs,
  validateSettings
} from "./state.js";
import { createBreathDetector, estimateCalibrationBpm, formatPowers, pickRespirationAxis } from "./breath-detector.js";
import { createAudioController } from "./audio.js";
import { createSensorController, requestMotionPermission } from "./sensors.js";
import { buildReport, createLogger, finalizeDiagnostics } from "./diagnostics.js";
import { appendSessionRecord, saveDiagnosticReport } from "./storage.js";
import {
  bindElements,
  initStaticUi,
  readSettings,
  setActivePreset,
  setPhase,
  setPrepVisible,
  setSensorStatus,
  setSessionControlLock,
  setStatus,
  updateDebugPanel,
  updateDebugSample,
  updateSettingLabels,
  updateStats,
  writeSettings
} from "./ui.js";

const els = bindElements();
const state = createAppState(createBreathDetector);
let log = createLogger(els, state);

function sessionDurationMs() {
  const settings = sessionSettings();
  return settings.duration_minutes * 60 * 1000;
}

function currentSettings() {
  const base = validateSettings(readSettings(els)).settings;
  const preset = PRESETS[state.activePreset] ? state.activePreset : inferPreset(base);
  const mode = PRESETS[preset] ? PRESETS[preset].mode : "adaptive";
  return { ...base, preset, mode };
}

function sessionSettings() {
  return state.sessionSettings || currentSettings();
}

function userBpmInfo() {
  if (Number.isFinite(state.breathDetector.currentBpm)) {
    return { value: state.breathDetector.currentBpm, source: "current rolling BPM", stale: false };
  }
  if (state.phase === "done" && Number.isFinite(state.breathDetector.lastBpm)) {
    return { value: state.breathDetector.lastBpm, source: "last detected rolling BPM; sensor weak near end", stale: true };
  }
  return { value: null, source: "unavailable", stale: false };
}

function completionMessage() {
  const bpm = userBpmInfo();
  if (Number.isFinite(bpm.value) && bpm.stale) {
    return `Session complete. Final live BPM unavailable; last detected was ${bpm.value.toFixed(1)} before the signal weakened. Take BP now if tracking it.`;
  }
  if (Number.isFinite(bpm.value)) {
    return `Session complete. Final detected BPM: ${bpm.value.toFixed(1)}. Sit up slowly. Take BP now if tracking it.`;
  }
  return "Session complete. Breath detection was weak near the end, so final BPM is unavailable. Take BP now if tracking it.";
}

function resetSessionState() {
  state.phase = "ready";
  state.sessionStartMs = 0;
  state.calibrationStartMs = 0;
  state.hiddenStartMs = 0;
  state.nextCycleAudioTime = 0;
  state.targetBpm = null;
  state.baselineBpm = null;
  state.sessionSettings = null;
  state.breathCount = 0;
  state.syncSamples = [];
  state.syncMisses = 0;
  state.missedCycleStreak = 0;
  state.fastBreathStreak = 0;
  state.weakSensorNoticeShown = false;
  state.scheduledInhales = [];
  clearScheduledTimeouts();
  state.axisSamples = [];
  state.axisName = null;
  state.axisSource = null;
  state.axisSelectedMs = 0;
  state.currentVisual = null;
  state.diagnostics = createDiagnostics();
  state.breathDetector = createBreathDetector();
  log = createLogger(els, state);
}

async function startSession() {
  if (state.phase !== "ready" && state.phase !== "done") return;
  const selectedPreset = state.activePreset;
  resetSessionState();
  state.activePreset = selectedPreset;
  const settings = currentSettings();
  state.sessionSettings = settings;
  state.activePreset = settings.preset;
  state.diagnostics.session_id = `sixbpm-${Date.now()}`;
  state.diagnostics.started_at = new Date().toISOString();
  state.diagnostics.settings = { ...settings, preset: state.activePreset };
  state.diagnostics.settings_start = { ...state.diagnostics.settings };
  state.diagnostics.settings_final = { ...state.diagnostics.settings };

  try {
    state.audio = createAudioController(log);
    await state.audio.ensure();
    state.diagnostics.audio_state = state.audio.ctx ? state.audio.ctx.state : "unavailable";
    if (settings.mode === "humming478") {
      state.diagnostics.permission = "not needed for fixed 4-7-8 hum mode";
    } else {
      await requestMotionPermission();
      state.diagnostics.permission = "granted";
    }
  } catch (error) {
    state.diagnostics.permission = error.message;
    log(error.message);
    setStatus(els, error.message);
    setSensorStatus(els, error.message.includes("denied") ? "denied" : "", error.message.includes("denied") ? "Motion access denied" : "Sensor: unavailable");
    return;
  }

  state.phase = settings.mode === "humming478" ? "pacing" : "calibrating";
  state.sessionStartMs = performance.now();
  state.calibrationStartMs = settings.mode === "humming478" ? 0 : state.sessionStartMs;
  els.startButton.disabled = true;
  els.stopButton.disabled = false;
  els.testButton.disabled = true;
  setSessionControlLock(els, true);
  setPrepVisible(els, false);
  updateStats(els, state, userBpmInfo().value, sessionDurationMs());
  log("Session started");
  document.addEventListener("visibilitychange", onVisibilityChange);
  startDebugPanel();
  await state.audio.requestWakeLock(state.diagnostics);

  if (settings.mode === "humming478") {
    setSensorStatus(els, "", "Sensor: not used in hum mode");
    beginHummingPacing();
    state.sessionTimer = window.setInterval(tickSession, 250);
    return;
  }

  els.orb.classList.add("calibrating");
  setPhase(els, "calibrating");
  setStatus(els, "Calibrating. Keep the phone still while we find your breathing signal.");
  setSensorStatus(els, "active", "Sensor: active");
  log("Calibration started");

  state.sensors = createSensorController({
    state,
    processSample,
    updateDebugSample: (source, values) => updateDebugSample(els, source, values),
    setSensorHelp,
    log
  });
  state.sensors.start();
  startSensorWatchdog();
  state.sessionTimer = window.setInterval(tickSession, 250);
}

function stopSession() {
  finishSession(false);
}

function finishSession(completed) {
  const wasActive = state.phase !== "ready" && state.phase !== "done";
  window.clearInterval(state.sessionTimer);
  window.clearInterval(state.schedulerTimer);
  window.clearInterval(state.sensorWatchdogTimer);
  window.clearInterval(state.debugTimer);
  window.cancelAnimationFrame(state.rafId);
  clearScheduledTimeouts();
  if (state.sensors) state.sensors.stop();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (state.audio) state.audio.releaseWakeLock();
  els.orb.classList.remove("calibrating");
  els.orb.style.transform = "scale(1)";
  els.startButton.disabled = false;
  els.stopButton.disabled = true;
  els.testButton.disabled = false;
  setSessionControlLock(els, false);
  setPrepVisible(els, true);

  if (completed) {
    state.phase = "done";
    setPhase(els, "done");
    els.timeRemaining.textContent = "0:00";
    updateStats(els, state, userBpmInfo().value, sessionDurationMs());
    setStatus(els, completionMessage());
    log("Session ended");
    persistFinalState("completed");
  } else if (wasActive) {
    state.phase = "ready";
    setPhase(els, "ready");
    setStatus(els, "Session stopped.");
    log("Session stopped");
    persistFinalState("stopped");
    updateStats(els, state, userBpmInfo().value, sessionDurationMs());
  }
}

function persistFinalState(status) {
  finalizeDiagnostics(state, status, userBpmInfo);
  try {
    saveDiagnosticReport(buildReport(state, els.sessionLog.textContent, userBpmInfo, calibrationRemainingMs()));
    log("Diagnostic report saved locally");
  } catch (error) {
    log(`Diagnostic save failed: ${error.message}`);
  }
  if (status === "completed") saveSessionRecord();
}

function saveSessionRecord() {
  const record = {
    ts: new Date().toISOString(),
    baseline_bpm: rounded(state.baselineBpm),
    final_target_bpm: rounded(state.targetBpm),
    final_user_bpm: rounded(userBpmInfo().value),
    breath_count: state.breathCount,
    sync_quality_score: rounded(calculateSyncScore(state.syncSamples))
  };
  try {
    appendSessionRecord(record);
    log("Session saved");
  } catch (error) {
    log(`Session save failed: ${error.message}`);
  }
}

function tickSession() {
  const now = performance.now();
  if (document.visibilityState !== "visible" && (state.phase === "calibrating" || state.phase === "pacing")) {
    setStatus(els, "Keep this page visible during the session.");
    updateStats(els, state, userBpmInfo().value, sessionDurationMs());
    return;
  }
  updateStats(els, state, userBpmInfo().value, sessionDurationMs());
  if (now - state.sessionStartMs >= sessionDurationMs()) {
    finishSession(true);
    return;
  }
  if (state.phase === "calibrating" && now - state.calibrationStartMs >= TIMING.calibrationMs) {
    if (!calibrationReady(now)) {
      setStatus(els, "Calibrating. Waiting for a cleaner breathing signal.");
      return;
    }
    beginPacing();
  }
}

function calibrationRemainingMs() {
  if (state.phase !== "calibrating") return 0;
  return Math.max(0, TIMING.calibrationMs - (performance.now() - state.calibrationStartMs));
}

function calibrationReady(now) {
  if (!state.axisName) return false;
  if (now - state.axisSelectedMs < 25000) return false;
  return state.breathDetector.peaks.length >= 2 || now - state.calibrationStartMs >= 90000;
}

function beginHummingPacing() {
  const timing = humming478Timing();
  state.targetBpm = timing.targetBpm;
  state.phase = "pacing";
  state.diagnostics.baseline_source = "fixed 4-7-8 hum mode";
  state.diagnostics.target_start_bpm = timing.targetBpm;
  state.diagnostics.pacer_only_mode = true;
  state.diagnostics.sensor_source = "not used";
  setStatus(els, "4-7-8 hum mode. Inhale, hold, then hum out slowly.");
  setPhase(els, "inhale");
  log("4-7-8 hum mode started");
  log("Pattern: inhale 4s, hold 7s, hum exhale 8s");
  state.nextCycleAudioTime = state.audio.ctx.currentTime + 0.25;
  scheduleNextCycle();
  state.schedulerTimer = window.setInterval(scheduleAhead, 250);
  animateOrb();
}

function beginPacing() {
  const measured = state.breathDetector.currentBpm;
  const fallback = estimateCalibrationBpm(state.breathDetector.peaks);
  const rawBaseline = Number.isFinite(measured) ? measured : Number.isFinite(fallback) ? fallback : 12;
  const baseline = clamp(rawBaseline || 12, 6, LIMITS.maxStartBpm);
  const baselineSource = Number.isFinite(measured) ? "detected rolling BPM" : Number.isFinite(fallback) ? "detected calibration peaks" : "fallback 12 BPM, not enough peaks";
  const floor = sessionSettings().floor_bpm;

  state.baselineBpm = Math.max(floor, baseline);
  state.targetBpm = Math.max(floor, Math.min(LIMITS.maxStartBpm, state.baselineBpm - 1));
  state.phase = "pacing";
  els.orb.classList.remove("calibrating");
  state.diagnostics.baseline_source = baselineSource;
  state.diagnostics.baseline_bpm = rounded(state.baselineBpm);
  state.diagnostics.target_start_bpm = rounded(state.targetBpm);
  setStatus(els, baselineSource.includes("fallback") ? "Pacing started with fallback baseline; sensor data was weak." : "Follow the tones.");
  setPhase(els, "inhale");
  log(`Baseline ${baselineSource}: ${state.baselineBpm.toFixed(1)} BPM`);
  if (rawBaseline !== baseline) log(`Raw detected baseline ${rawBaseline.toFixed(1)} BPM clamped to ${baseline.toFixed(1)} BPM`);
  log(`Pacing starting at ${state.targetBpm.toFixed(1)} BPM`);

  state.nextCycleAudioTime = state.audio.ctx.currentTime + 0.25;
  scheduleNextCycle();
  state.schedulerTimer = window.setInterval(scheduleAhead, 250);
  animateOrb();
}

function scheduleAhead() {
  if (state.phase !== "pacing") return;
  while (state.nextCycleAudioTime < state.audio.ctx.currentTime + 2.5) scheduleNextCycle();
}

function scheduleNextCycle() {
  const settings = sessionSettings();
  if (settings.mode === "humming478") {
    scheduleHummingCycle();
    return;
  }
  const timing = cycleTiming(state.targetBpm || settings.floor_bpm, settings.ratio);
  const startAt = state.nextCycleAudioTime;
  const startMs = performance.now() + Math.max(0, (startAt - state.audio.ctx.currentTime) * 1000);
  const expectedPeakMs = startMs + timing.inhaleSeconds * 1000;
  state.breathCount += 1;
  const cycle = { id: state.breathCount, startMs, ms: expectedPeakMs, target: timing.targetBpm, hasPeak: false, detectedBpm: null, divergence: null, timingDeltaMs: null, evaluated: false };
  state.scheduledInhales.push(cycle);
  state.scheduledInhales = state.scheduledInhales.filter((scheduled) => startMs - scheduled.startMs < 90000).slice(-18);
  state.diagnostics.pacing_cycles = state.breathCount;
  const visual = { startAudio: startAt, inhaleSeconds: timing.inhaleSeconds, exhaleSeconds: timing.exhaleSeconds, cycleSeconds: timing.cycleSeconds };
  state.audio.scheduleTone(startAt, timing.inhaleSeconds, 330, 523);
  state.audio.scheduleTone(startAt + timing.inhaleSeconds, timing.exhaleSeconds, 523, 220);
  scheduleTimeout(() => { state.currentVisual = visual; setPhase(els, "inhale"); }, Math.max(0, (startAt - state.audio.ctx.currentTime) * 1000));
  scheduleTimeout(() => setPhase(els, "exhale"), Math.max(0, (startAt + timing.inhaleSeconds - state.audio.ctx.currentTime) * 1000));
  scheduleTimeout(() => evaluateDescent(cycle), Math.max(0, (startAt + timing.cycleSeconds - state.audio.ctx.currentTime) * 1000));
  state.nextCycleAudioTime += timing.cycleSeconds;
}

function scheduleHummingCycle() {
  const timing = humming478Timing();
  const startAt = state.nextCycleAudioTime;
  state.breathCount += 1;
  state.diagnostics.pacing_cycles = state.breathCount;
  const visual = { mode: "humming478", startAudio: startAt, inhaleSeconds: timing.inhaleSeconds, holdSeconds: timing.holdSeconds, exhaleSeconds: timing.exhaleSeconds, cycleSeconds: timing.cycleSeconds };
  state.audio.scheduleTone(startAt, timing.inhaleSeconds, 330, 523);
  state.audio.scheduleTone(startAt + timing.inhaleSeconds + timing.holdSeconds, timing.exhaleSeconds, 220, 185);
  scheduleTimeout(() => { state.currentVisual = visual; setPhase(els, "inhale"); }, Math.max(0, (startAt - state.audio.ctx.currentTime) * 1000));
  scheduleTimeout(() => setPhase(els, "hold"), Math.max(0, (startAt + timing.inhaleSeconds - state.audio.ctx.currentTime) * 1000));
  scheduleTimeout(() => setPhase(els, "hum"), Math.max(0, (startAt + timing.inhaleSeconds + timing.holdSeconds - state.audio.ctx.currentTime) * 1000));
  state.nextCycleAudioTime += timing.cycleSeconds;
}

function evaluateDescent(cycle) {
  if (state.phase !== "pacing" || !state.targetBpm || !cycle || cycle.evaluated) return;
  cycle.evaluated = true;
  const floor = sessionSettings().floor_bpm;
  const sensorActive = !state.diagnostics.pacer_only_mode;
  if (sensorActive && !cycle.hasPeak) {
    state.missedCycleStreak += 1;
    state.diagnostics.missed_cycle_count += 1;
    state.diagnostics.sync_miss_count += 1;
    state.syncSamples.push(LIMITS.syncDivergenceBpm + 1);
    state.syncSamples = state.syncSamples.slice(-80);
    if (state.missedCycleStreak >= TIMING.sensorWeakStreak && !state.weakSensorNoticeShown) {
      state.weakSensorNoticeShown = true;
      setStatus(els, "Sensor signal is weak. Keep following the tones.");
      log("Sensor signal weak; pacer descent will continue");
    }
  } else if (cycle.hasPeak) {
    state.missedCycleStreak = 0;
  }
  const decision = descentDecision({ targetBpm: state.targetBpm, floorBpm: floor, cycleHasPeak: cycle.hasPeak, detectedBpm: cycle.detectedBpm, fastBreathStreak: state.fastBreathStreak, pacerOnly: state.diagnostics.pacer_only_mode });
  state.fastBreathStreak = decision.fastBreathStreak;
  state.syncMisses = state.fastBreathStreak;
  if (decision.action === "hold") {
    state.diagnostics.hold_count += 1;
    state.diagnostics.fast_breath_hold_count += 1;
    setStatus(els, "Holding pace; your breathing is still faster than the target.");
    log(`Holding at ${state.targetBpm.toFixed(1)} BPM; detected ${cycle.detectedBpm.toFixed(1)} BPM`);
    return;
  }
  if (decision.action === "descend") {
    state.targetBpm = decision.targetBpm;
    if (cycle.hasPeak) state.diagnostics.sensor_assisted_descent_count += 1;
    else state.diagnostics.pacer_descent_count += 1;
    if (!state.weakSensorNoticeShown) setStatus(els, "Follow the tones. Inhale as the orb grows; exhale as it softens.");
  }
}

function animateOrb() {
  if (state.phase !== "pacing") return;
  const visual = state.currentVisual;
  if (visual) {
    const elapsed = state.audio.ctx.currentTime - visual.startAudio;
    let scale = 1;
    if (elapsed >= 0 && elapsed <= visual.inhaleSeconds) scale = 1 + 1.2 * easeInOut(elapsed / visual.inhaleSeconds);
    else if (visual.mode === "humming478" && elapsed > visual.inhaleSeconds && elapsed <= visual.inhaleSeconds + visual.holdSeconds) scale = 2.2;
    else if (visual.mode === "humming478" && elapsed > visual.inhaleSeconds + visual.holdSeconds && elapsed <= visual.cycleSeconds) scale = 2.2 - 1.2 * easeInOut((elapsed - visual.inhaleSeconds - visual.holdSeconds) / visual.exhaleSeconds);
    else if (elapsed > visual.inhaleSeconds && elapsed <= visual.cycleSeconds) scale = 2.2 - 1.2 * easeInOut((elapsed - visual.inhaleSeconds) / visual.exhaleSeconds);
    els.orb.style.transform = `scale(${scale.toFixed(3)})`;
  }
  state.rafId = window.requestAnimationFrame(animateOrb);
}

function easeInOut(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function onVisibilityChange() {
  const now = performance.now();
  const entry = { state: document.visibilityState, elapsed_ms: state.sessionStartMs ? Math.round(now - state.sessionStartMs) : null };
  state.diagnostics.visibility_state = document.visibilityState;
  state.diagnostics.visibility_changes.push(entry);
  state.diagnostics.visibility_changes = state.diagnostics.visibility_changes.slice(-20);
  log(`Visibility: ${document.visibilityState}`);
  if (document.visibilityState !== "visible" && (state.phase === "calibrating" || state.phase === "pacing")) {
    state.hiddenStartMs = now;
    setStatus(els, "Session paused. Keep this page visible during the session.");
    return;
  }
  if (state.hiddenStartMs && (state.phase === "calibrating" || state.phase === "pacing")) {
    const hiddenMs = now - state.hiddenStartMs;
    state.sessionStartMs += hiddenMs;
    state.calibrationStartMs += hiddenMs;
    if (state.phase === "pacing" && state.audio && state.nextCycleAudioTime) state.nextCycleAudioTime = Math.max(state.nextCycleAudioTime, state.audio.ctx.currentTime + 0.25);
    state.diagnostics.hidden_pause_ms += Math.round(hiddenMs);
    state.hiddenStartMs = 0;
    setStatus(els, state.phase === "calibrating" ? "Calibration resumed." : "Session resumed.");
    log(`Session clock paused for ${(hiddenMs / 1000).toFixed(1)}s while hidden`);
  }
}

function processSample(sample) {
  if (!state.axisName) {
    state.axisSamples.push(sample);
    const elapsed = sample.t - state.calibrationStartMs;
    if (elapsed >= TIMING.axisPickMs) {
      const axisResult = pickRespirationAxis(state.axisSamples);
      state.axisName = axisResult.axis;
      state.axisSource = axisResult.source;
      state.axisSelectedMs = sample.t;
      state.diagnostics.selected_axis = state.axisName;
      state.diagnostics.sensor_source = axisResult.source;
      state.diagnostics.axis_variance = axisResult.powers;
      state.diagnostics.selected_sample_hz = rounded(axisResult.sampleRate);
      state.breathDetector.setAxis(state.axisName, axisResult.sampleRate);
      log(`Respiration signal: ${axisResult.source}.${state.axisName} at ${axisResult.sampleRate.toFixed(1)} Hz`);
      log(`Axis variance ${formatPowers(axisResult.powers)}`);
    }
    return;
  }
  if (sample.source !== state.axisSource || !Number.isFinite(sample[state.axisName])) return;
  const peak = state.breathDetector.addSample(sample.t, sample[state.axisName]);
  state.diagnostics.rejected_peak_count = state.breathDetector.rejectedPeakCount;
  if (peak) handleDetectedBreath(peak);
}

function handleDetectedBreath(peak) {
  if (state.phase === "calibrating") state.diagnostics.calibration_peak_count += 1;
  if (state.phase === "pacing") state.diagnostics.pacing_peak_count += 1;
  updateStats(els, state, userBpmInfo().value, sessionDurationMs());
  if (state.phase !== "pacing") return;
  const match = nearestScheduledInhale(peak.t);
  if (!match) return;
  const scheduled = match.cycle;
  const detectedBpm = state.breathDetector.currentBpm;
  const divergence = Number.isFinite(detectedBpm) ? Math.abs(detectedBpm - scheduled.target) : 0;
  scheduled.hasPeak = true;
  scheduled.detectedBpm = Number.isFinite(detectedBpm) ? detectedBpm : null;
  scheduled.divergence = divergence;
  scheduled.timingDeltaMs = match.delta;
  state.missedCycleStreak = 0;
  state.syncSamples.push(divergence);
  state.syncSamples = state.syncSamples.slice(-80);
  state.diagnostics.sync_event_count += 1;
  if (divergence > LIMITS.syncDivergenceBpm) state.diagnostics.sync_miss_count += 1;
  else if (!state.weakSensorNoticeShown) setStatus(els, "Follow the tones.");
}

function nearestScheduledInhale(ms) {
  let best = null;
  for (const cycle of state.scheduledInhales) {
    if (cycle.evaluated) continue;
    const delta = Math.abs(cycle.ms - ms);
    if (!best || delta < best.delta) best = { cycle, delta };
  }
  if (!best) return null;
  return best.delta <= syncWindowMs(best.cycle.target) ? best : null;
}

function startSensorWatchdog() {
  state.sensorWatchdogTimer = window.setInterval(() => {
    if (state.phase !== "calibrating" && state.phase !== "pacing") return;
    const total = state.diagnostics.motion_events + state.diagnostics.orientation_events + state.diagnostics.generic_sensor_events;
    const decision = sensorFallbackDecision({ totalEvents: total, elapsedMs: performance.now() - state.sessionStartMs, genericSensorStatus: state.diagnostics.generic_sensor_status });
    if (!decision.pacerOnly) return;
    setSensorHelp(decision.message);
    state.diagnostics.pacer_only_mode = true;
    state.syncMisses = 0;
    setSensorStatus(els, "denied", "Sensor: pacer-only mode");
    setStatus(els, "Sensor blocked. Continuing as a pacer without breath detection.");
    log(`Sensor warning: only ${total} sensor events after 8 seconds; pacer-only mode`);
    window.clearInterval(state.sensorWatchdogTimer);
  }, 4000);
}

function setSensorHelp(message) {
  state.diagnostics.sensor_help = message;
  state.diagnostics.sensor_warning = message;
  setSensorStatus(els, "denied", "Sensor: permission blocked");
  setStatus(els, message);
}

function startDebugPanel() {
  updateDebugPanel(els, state);
  state.debugTimer = window.setInterval(() => updateDebugPanel(els, state), 250);
}

function scheduleTimeout(fn, delay) {
  const id = window.setTimeout(() => {
    state.timeouts = state.timeouts.filter((timeoutId) => timeoutId !== id);
    fn();
  }, delay);
  state.timeouts.push(id);
  return id;
}

function clearScheduledTimeouts() {
  for (const id of state.timeouts) window.clearTimeout(id);
  state.timeouts = [];
}

function recordSettingChange(input) {
  if (!input || !state.sessionStartMs || (state.phase !== "calibrating" && state.phase !== "pacing")) return;
  const keyById = { ratioSlider: "ratio", floorSlider: "floor_bpm", durationSlider: "duration_minutes" };
  const key = keyById[input.id];
  if (!key) return;
  const value = rounded(Number(input.value));
  const elapsedMs = Math.round(performance.now() - state.sessionStartMs);
  const last = state.diagnostics.settings_changes[state.diagnostics.settings_changes.length - 1];
  if (last && last.key === key && last.value === value) return;
  state.diagnostics.settings_changes.push({ elapsed_ms: elapsedMs, key, value });
  state.diagnostics.settings_changes = state.diagnostics.settings_changes.slice(-20);
  state.diagnostics.settings_final = currentSettings();
  log(`Setting changed: ${key} ${value}`);
}

async function copyReport() {
  const reportObject = buildReport(state, els.sessionLog.textContent, userBpmInfo, calibrationRemainingMs());
  const report = JSON.stringify(reportObject, null, 2);
  els.reportText.value = report;
  els.reportSection.hidden = false;
  els.reportText.focus();
  els.reportText.select();
  try { saveDiagnosticReport(report); } catch (error) { log(`Diagnostic save failed: ${error.message}`); }
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(report);
    setStatus(els, reportObject.current.report_note);
    log("Diagnostic report copied");
  } catch (error) {
    setStatus(els, "Report is shown below. Select it and copy manually.");
    log(`Clipboard copy blocked: ${error.message}`);
  }
}

async function testTones() {
  try {
    if (!state.audio) state.audio = createAudioController(log);
    await state.audio.ensure();
  } catch (error) {
    log(error.message);
    setStatus(els, error.message);
    return;
  }
  const settings = currentSettings();
  const timing = settings.mode === "humming478" ? humming478Timing() : cycleTiming(settings.floor_bpm, settings.ratio);
  const startAt = state.audio.ctx.currentTime + 0.1;
  state.audio.scheduleTone(startAt, timing.inhaleSeconds, 330, 523);
  if (settings.mode === "humming478") {
    state.audio.scheduleTone(startAt + timing.inhaleSeconds + timing.holdSeconds, timing.exhaleSeconds, 220, 185);
    state.currentVisual = { mode: "humming478", startAudio: startAt, inhaleSeconds: timing.inhaleSeconds, holdSeconds: timing.holdSeconds, exhaleSeconds: timing.exhaleSeconds, cycleSeconds: timing.cycleSeconds };
  } else {
    state.audio.scheduleTone(startAt + timing.inhaleSeconds, timing.exhaleSeconds, 523, 220);
    state.currentVisual = { startAudio: startAt, inhaleSeconds: timing.inhaleSeconds, exhaleSeconds: timing.exhaleSeconds, cycleSeconds: timing.cycleSeconds };
  }
  state.phase = "pacing";
  animateOrb();
  setStatus(els, settings.mode === "humming478" ? "Testing one 4-7-8 hum cycle." : "Testing one breath cycle.");
  log(settings.mode === "humming478" ? "Test 4-7-8 hum cycle started" : "Test tone cycle started");
  scheduleTimeout(() => setPhase(els, "inhale"), 100);
  if (settings.mode === "humming478") {
    scheduleTimeout(() => setPhase(els, "hold"), 100 + timing.inhaleSeconds * 1000);
    scheduleTimeout(() => setPhase(els, "hum"), 100 + (timing.inhaleSeconds + timing.holdSeconds) * 1000);
  } else {
    scheduleTimeout(() => setPhase(els, "exhale"), 100 + timing.inhaleSeconds * 1000);
  }
  scheduleTimeout(() => {
    state.phase = "ready";
    window.cancelAnimationFrame(state.rafId);
    els.orb.style.transform = "scale(1)";
    setPhase(els, "ready");
    setStatus(els, "Ready.");
  }, (timing.cycleSeconds + 0.2) * 1000);
}

function onPresetClick(event) {
  const id = event.currentTarget.dataset.preset;
  state.activePreset = id;
  writeSettings(els, applyPreset(id, currentSettings()));
  setActivePreset(els, id);
}

function handleSettingInput() {
  updateSettingLabels(els);
  state.activePreset = "custom";
  setActivePreset(els, "custom");
}

function handleSettingChange(event) {
  handleSettingInput();
  recordSettingChange(event.target);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js?v=cache-v29").catch((error) => log(`Service worker registration failed: ${error.message}`));
  }
}

function init() {
  initStaticUi(els);
  writeSettings(els, PRESETS.six);
  updateStats(els, state, userBpmInfo().value, PRESETS.six.duration_minutes * 60 * 1000);
  for (const button of els.presetButtons) button.addEventListener("click", onPresetClick);
  for (const slider of [els.ratioSlider, els.floorSlider, els.durationSlider]) {
    slider.addEventListener("input", handleSettingInput);
    slider.addEventListener("change", handleSettingChange);
  }
  els.startButton.addEventListener("click", startSession);
  els.stopButton.addEventListener("click", stopSession);
  els.testButton.addEventListener("click", testTones);
  els.copyReportButton.addEventListener("click", copyReport);
  registerServiceWorker();
  log(`App ready (${APP_VERSION})`);
}

init();
