import { APP_VERSION, PRESETS, formatBpm, formatTime } from "./state.js";

export function bindElements() {
  const $ = (id) => document.getElementById(id);
  return {
    orb: $("orb"),
    phaseLabel: $("phaseLabel"),
    targetBpm: $("targetBpm"),
    userBpm: $("userBpm"),
    timeRemaining: $("timeRemaining"),
    presetButtons: Array.from(document.querySelectorAll("[data-preset]")),
    ratioSlider: $("ratioSlider"),
    floorSlider: $("floorSlider"),
    durationSlider: $("durationSlider"),
    ratioValue: $("ratioValue"),
    floorValue: $("floorValue"),
    durationValue: $("durationValue"),
    prepNote: $("prepNote"),
    versionLabel: $("versionLabel"),
    sensorDot: $("sensorDot"),
    sensorLabel: $("sensorLabel"),
    statusMessage: $("statusMessage"),
    startButton: $("startButton"),
    stopButton: $("stopButton"),
    testButton: $("testButton"),
    copyReportButton: $("copyReportButton"),
    reportSection: $("reportSection"),
    reportText: $("reportText"),
    debugLine: $("debugLine"),
    debugSample: $("debugSample"),
    sessionLog: $("sessionLog")
  };
}

export function readSettings(els) {
  return {
    ratio: Number(els.ratioSlider.value),
    floor_bpm: Number(els.floorSlider.value),
    duration_minutes: Number(els.durationSlider.value)
  };
}

export function writeSettings(els, settings) {
  els.ratioSlider.value = String(settings.ratio);
  els.floorSlider.value = String(settings.floor_bpm);
  els.durationSlider.value = String(settings.duration_minutes);
  updateSettingLabels(els);
}

export function updateSettingLabels(els) {
  els.ratioValue.textContent = `1:${Number(els.ratioSlider.value).toFixed(1)}`;
  els.floorValue.textContent = Number(els.floorSlider.value).toFixed(1);
  els.durationValue.textContent = `${Number(els.durationSlider.value).toFixed(0)} min`;
}

export function setActivePreset(els, presetId) {
  for (const button of els.presetButtons) {
    const active = button.dataset.preset === presetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

export function setStatus(els, message) {
  els.statusMessage.textContent = message;
}

export function setPhase(els, phase) {
  els.phaseLabel.textContent = phase.toUpperCase();
}

export function setPrepVisible(els, visible) {
  if (els.prepNote) els.prepNote.hidden = !visible;
}

export function setSensorStatus(els, kind, label) {
  els.sensorDot.className = "sensor-dot";
  if (kind) els.sensorDot.classList.add(kind);
  els.sensorLabel.textContent = label;
}

export function setSessionControlLock(els, locked) {
  els.ratioSlider.disabled = locked;
  els.floorSlider.disabled = locked;
  els.durationSlider.disabled = locked;
  for (const button of els.presetButtons) button.disabled = locked;
}

export function updateStats(els, state, userBpmValue, durationMs) {
  els.targetBpm.textContent = formatBpm(state.targetBpm);
  els.userBpm.textContent = formatBpm(userBpmValue);
  const elapsed = state.sessionStartMs ? performance.now() - state.sessionStartMs : 0;
  els.timeRemaining.textContent = formatTime(durationMs - elapsed);
}

export function updateDebugPanel(els, state) {
  if (!els.debugLine) return;
  const lastTimes = [state.diagnostics.last_motion_ms, state.diagnostics.last_orientation_ms, state.diagnostics.last_generic_sensor_ms].filter(Number.isFinite);
  const lastElapsed = lastTimes.length ? Math.max(...lastTimes) : null;
  const nowElapsed = state.sessionStartMs ? Math.round(performance.now() - state.sessionStartMs) : 0;
  const gap = lastElapsed === null ? "none" : `${((nowElapsed - lastElapsed) / 1000).toFixed(1)}s`;
  els.debugLine.textContent = `Sensor debug: motion ${state.diagnostics.motion_events}, orientation ${state.diagnostics.orientation_events}, generic ${state.diagnostics.generic_sensor_events}, gap ${gap}, visible ${document.visibilityState}`;
}

export function updateDebugSample(els, source, values) {
  if (!els.debugSample) return;
  const parts = Object.keys(values).map((key) => `${key}:${Number.isFinite(values[key]) ? values[key].toFixed(2) : "null"}`);
  els.debugSample.textContent = `Last sample: ${source} ${parts.join(" ")}`;
}

export function initStaticUi(els) {
  els.versionLabel.textContent = `Version: ${APP_VERSION}`;
  setPhase(els, "ready");
  updateSettingLabels(els);
  setActivePreset(els, PRESETS.calm.id);
}
