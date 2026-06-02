export const APP_VERSION = "diagnostics-v21 / cache-v28";

export const LIMITS = Object.freeze({
  minRatio: 1,
  maxRatio: 2,
  minFloorBpm: 5,
  maxFloorBpm: 10,
  minDurationMinutes: 15,
  maxDurationMinutes: 20,
  maxStartBpm: 12,
  minTargetBpm: 5,
  syncDivergenceBpm: 2
});

export const TIMING = Object.freeze({
  calibrationMs: 60 * 1000,
  axisPickMs: 15 * 1000,
  descentPerCycle: 0.2,
  refractoryMs: 3000,
  fastBreathHoldStreak: 3,
  sensorWeakStreak: 6
});

export const STORAGE_KEY = "sixbpm.sessions";
export const REPORT_STORAGE_KEY = "sixbpm.lastReport";

export const PRESETS = Object.freeze({
  balanced: Object.freeze({ id: "balanced", label: "Balanced", ratio: 1, floor_bpm: 6, duration_minutes: 15, note: "5s inhale, 5s exhale at 6 BPM" }),
  calm: Object.freeze({ id: "calm", label: "Calm", ratio: 2, floor_bpm: 6, duration_minutes: 15, note: "3.3s inhale, 6.7s exhale at 6 BPM" }),
  extended: Object.freeze({ id: "extended", label: "Extended", ratio: 2, floor_bpm: 6, duration_minutes: 20, note: "Calm 1:2 pacing for a longer session" }),
  custom: Object.freeze({ id: "custom", label: "Custom", ratio: 2, floor_bpm: 6, duration_minutes: 15, note: "User-adjusted settings" })
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

export function validateSettings(settings) {
  const ratio = Number(settings.ratio);
  const floor = Number(settings.floor_bpm);
  const duration = Number(settings.duration_minutes);
  const errors = [];
  if (!Number.isFinite(ratio) || ratio < LIMITS.minRatio || ratio > LIMITS.maxRatio) {
    errors.push(`ratio must be between 1:${LIMITS.minRatio.toFixed(1)} and 1:${LIMITS.maxRatio.toFixed(1)}`);
  }
  if (!Number.isFinite(floor) || floor < LIMITS.minFloorBpm || floor > LIMITS.maxFloorBpm) {
    errors.push(`floor BPM must be between ${LIMITS.minFloorBpm} and ${LIMITS.maxFloorBpm}`);
  }
  if (!Number.isFinite(duration) || duration < LIMITS.minDurationMinutes || duration > LIMITS.maxDurationMinutes) {
    errors.push(`duration must be between ${LIMITS.minDurationMinutes} and ${LIMITS.maxDurationMinutes} minutes`);
  }
  return {
    ok: errors.length === 0,
    errors,
    settings: {
      ratio: clamp(Number.isFinite(ratio) ? ratio : PRESETS.custom.ratio, LIMITS.minRatio, LIMITS.maxRatio),
      floor_bpm: clamp(Number.isFinite(floor) ? floor : PRESETS.custom.floor_bpm, LIMITS.minFloorBpm, LIMITS.maxFloorBpm),
      duration_minutes: clamp(Number.isFinite(duration) ? duration : PRESETS.custom.duration_minutes, LIMITS.minDurationMinutes, LIMITS.maxDurationMinutes)
    }
  };
}

export function applyPreset(id, current = PRESETS.custom) {
  const preset = PRESETS[id] || PRESETS.custom;
  const next = {
    ratio: preset.id === "custom" ? current.ratio : preset.ratio,
    floor_bpm: preset.id === "custom" ? current.floor_bpm : preset.floor_bpm,
    duration_minutes: preset.id === "custom" ? current.duration_minutes : preset.duration_minutes
  };
  return validateSettings(next).settings;
}

export function inferPreset(settings) {
  for (const preset of [PRESETS.balanced, PRESETS.calm, PRESETS.extended]) {
    if (Number(settings.ratio) === preset.ratio && Number(settings.floor_bpm) === preset.floor_bpm && Number(settings.duration_minutes) === preset.duration_minutes) {
      return preset.id;
    }
  }
  return "custom";
}

export function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatBpm(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "--";
}

export function cycleTiming(targetBpm, ratio) {
  const safeTarget = clamp(Number(targetBpm) || 6, LIMITS.minTargetBpm, LIMITS.maxStartBpm);
  const safeRatio = validateSettings({ ratio, floor_bpm: 6, duration_minutes: 15 }).settings.ratio;
  const cycleSeconds = 60 / safeTarget;
  const inhaleSeconds = cycleSeconds / (1 + safeRatio);
  return { targetBpm: safeTarget, ratio: safeRatio, cycleSeconds, inhaleSeconds, exhaleSeconds: cycleSeconds - inhaleSeconds };
}

export function calculateSyncScore(samples, divergenceBpm = LIMITS.syncDivergenceBpm) {
  if (!samples.length) return 0;
  const good = samples.filter((value) => value <= divergenceBpm).length;
  return (good / samples.length) * 100;
}

export function syncWindowMs(targetBpm) {
  const cycleMs = 60000 / clamp(targetBpm || 6, 4, 24);
  return clamp(cycleMs * 0.45, 3500, 6500);
}

export function descentDecision({ targetBpm, floorBpm, cycleHasPeak, detectedBpm, fastBreathStreak = 0, pacerOnly = false }) {
  const detectedFast = !pacerOnly && cycleHasPeak && Number.isFinite(detectedBpm) && detectedBpm > targetBpm + LIMITS.syncDivergenceBpm;
  const nextFastBreathStreak = detectedFast ? fastBreathStreak + 1 : 0;
  if (nextFastBreathStreak >= TIMING.fastBreathHoldStreak) {
    return { action: "hold", targetBpm, fastBreathStreak: nextFastBreathStreak };
  }
  if (targetBpm > floorBpm) {
    return { action: "descend", targetBpm: Math.max(floorBpm, targetBpm - TIMING.descentPerCycle), fastBreathStreak: nextFastBreathStreak };
  }
  return { action: "floor", targetBpm, fastBreathStreak: nextFastBreathStreak };
}

export function sensorFallbackDecision({ totalEvents, elapsedMs, genericSensorStatus = "" }) {
  if (totalEvents >= 5 || elapsedMs <= 8000) {
    return { pacerOnly: false, message: "" };
  }
  const permissionDenied = String(genericSensorStatus).toLowerCase().includes("permission");
  return {
    pacerOnly: true,
    message: permissionDenied
      ? "Browser denied sensor access. In Chrome, open site settings for this page and allow motion sensors. In Brave, disable Shields or allow motion sensors for this site."
      : "Sensor events are blocked. Try regular Chrome, enable motion sensors in site settings, or disable Brave Shields for this site."
  };
}

export function createDiagnostics() {
  return {
    app_version: APP_VERSION,
    session_id: "",
    started_at: "",
    ended_at: "",
    url: typeof location === "undefined" ? "" : location.href,
    user_agent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    permission: "not requested",
    audio_state: "not started",
    wake_lock: "not requested",
    settings: {},
    settings_start: {},
    settings_final: {},
    settings_changes: [],
    motion_events: 0,
    orientation_events: 0,
    generic_sensor_events: 0,
    motion_hz_estimate: null,
    orientation_hz_estimate: null,
    generic_sensor_hz_estimate: null,
    first_motion_ms: null,
    last_motion_ms: null,
    first_orientation_ms: null,
    last_orientation_ms: null,
    first_generic_sensor_ms: null,
    last_generic_sensor_ms: null,
    generic_sensor_status: "not started",
    selected_axis: null,
    selected_sample_hz: null,
    sensor_source: "none",
    sensor_warning: "",
    sensor_help: "",
    pacer_only_mode: false,
    axis_variance: null,
    calibration_peak_count: 0,
    pacing_peak_count: 0,
    rejected_peak_count: 0,
    baseline_source: "none",
    baseline_bpm: null,
    target_start_bpm: null,
    final_target_bpm: null,
    final_user_bpm: null,
    final_user_bpm_source: "none",
    pacing_cycles: 0,
    sync_event_count: 0,
    sync_miss_count: 0,
    missed_cycle_count: 0,
    fast_breath_hold_count: 0,
    pacer_descent_count: 0,
    sensor_assisted_descent_count: 0,
    hold_count: 0,
    sync_quality_score: null,
    visibility_state: typeof document === "undefined" ? "unknown" : document.visibilityState,
    visibility_changes: [],
    hidden_pause_ms: 0,
    log: []
  };
}

export function createAppState(createDetector) {
  return {
    phase: "ready",
    audio: null,
    sensors: null,
    sessionStartMs: 0,
    calibrationStartMs: 0,
    hiddenStartMs: 0,
    sessionTimer: 0,
    schedulerTimer: 0,
    sensorWatchdogTimer: 0,
    debugTimer: 0,
    rafId: 0,
    nextCycleAudioTime: 0,
    targetBpm: null,
    baselineBpm: null,
    sessionSettings: null,
    activePreset: "calm",
    breathCount: 0,
    syncSamples: [],
    syncMisses: 0,
    missedCycleStreak: 0,
    fastBreathStreak: 0,
    weakSensorNoticeShown: false,
    scheduledInhales: [],
    timeouts: [],
    breathDetector: createDetector(),
    axisSamples: [],
    axisName: null,
    axisSource: null,
    axisSelectedMs: 0,
    currentVisual: null,
    diagnostics: createDiagnostics()
  };
}
