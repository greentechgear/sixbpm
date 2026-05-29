(function () {
  "use strict";

  const SESSION_MS = 15 * 60 * 1000;
  const CALIBRATION_MS = 60 * 1000;
  const AXIS_PICK_MS = 15 * 1000;
  const DESCENT_PER_CYCLE = 0.2;
  const SYNC_DIVERGENCE_BPM = 2;
  const FAST_BREATH_HOLD_STREAK = 3;
  const SENSOR_WEAK_STREAK = 6;
  const REFRACTORY_MS = 3000;
  const TONE_OUTPUT_GAIN = 0.5;
  const STORAGE_KEY = "sixbpm.sessions";
  const REPORT_STORAGE_KEY = "sixbpm.lastReport";
  const APP_VERSION = "diagnostics-v19 / cache-v26";

  const $ = (id) => document.getElementById(id);
  const els = {
    orb: $("orb"),
    phaseLabel: $("phaseLabel"),
    targetBpm: $("targetBpm"),
    userBpm: $("userBpm"),
    timeRemaining: $("timeRemaining"),
    ratioSlider: $("ratioSlider"),
    floorSlider: $("floorSlider"),
    ratioValue: $("ratioValue"),
    floorValue: $("floorValue"),
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

  const state = {
    phase: "ready",
    audioCtx: null,
    masterGain: null,
    wakeLock: null,
    noSleep: null,
    genericSensor: null,
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
    breathCount: 0,
    syncSamples: [],
    syncMisses: 0,
    missedCycleStreak: 0,
    fastBreathStreak: 0,
    weakSensorNoticeShown: false,
    scheduledInhales: [],
    timeouts: [],
    breathDetector: createBreathDetector(),
    axisSamples: [],
    axisName: null,
    axisSource: null,
    axisSelectedMs: 0,
    currentVisual: null,
    diagnostics: createDiagnostics()
  };

  function createDiagnostics() {
    return {
      app_version: APP_VERSION,
      session_id: "",
      started_at: "",
      ended_at: "",
      url: location.href,
      user_agent: navigator.userAgent,
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
      pacing_cycles: 0,
      sync_event_count: 0,
      sync_miss_count: 0,
      missed_cycle_count: 0,
      fast_breath_hold_count: 0,
      pacer_descent_count: 0,
      sensor_assisted_descent_count: 0,
      hold_count: 0,
      sync_quality_score: null,
      visibility_state: document.visibilityState,
      visibility_changes: [],
      hidden_pause_ms: 0,
      log: []
    };
  }

  function log(message) {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    els.sessionLog.textContent += `[${stamp}] ${message}\n`;
    els.sessionLog.scrollTop = els.sessionLog.scrollHeight;
    if (state.diagnostics) {
      state.diagnostics.log.push(`[${stamp}] ${message}`);
      state.diagnostics.log = state.diagnostics.log.slice(-220);
    }
  }

  function setStatus(message) {
    els.statusMessage.textContent = message;
  }

  function setPrepVisible(visible) {
    if (els.prepNote) {
      els.prepNote.hidden = !visible;
    }
  }

  function setPhase(phase) {
    els.phaseLabel.textContent = phase.toUpperCase();
  }

  function updateSliderLabels() {
    els.ratioValue.textContent = `1:${Number(els.ratioSlider.value).toFixed(1)}`;
    els.floorValue.textContent = Number(els.floorSlider.value).toFixed(1);
  }

  function handleSettingInput() {
    updateSliderLabels();
  }

  function handleSettingChange(event) {
    updateSliderLabels();
    recordSettingChange(event.target);
  }

  function formatBpm(value) {
    return Number.isFinite(value) ? value.toFixed(1) : "--";
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function updateStats() {
    els.targetBpm.textContent = formatBpm(state.targetBpm);
    els.userBpm.textContent = formatBpm(state.breathDetector.currentBpm);
    const elapsed = state.sessionStartMs ? performance.now() - state.sessionStartMs : 0;
    els.timeRemaining.textContent = formatTime(SESSION_MS - elapsed);
  }

  function setSensorStatus(kind, label) {
    els.sensorDot.className = "sensor-dot";
    if (kind) {
      els.sensorDot.classList.add(kind);
    }
    els.sensorLabel.textContent = label;
  }

  async function ensureAudio() {
    if (!window.AudioContext && !window.webkitAudioContext) {
      throw new Error("Web Audio is not supported.");
    }
    if (!state.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new Ctx();
      state.masterGain = state.audioCtx.createGain();
      state.masterGain.gain.value = TONE_OUTPUT_GAIN;
      state.masterGain.connect(state.audioCtx.destination);
    }
    if (state.audioCtx.state === "suspended") {
      await state.audioCtx.resume();
    }
  }

  async function requestMotionPermission() {
    if (!("DeviceMotionEvent" in window)) {
      throw new Error("Device motion is not supported.");
    }
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const result = await DeviceMotionEvent.requestPermission();
      if (result !== "granted") {
        throw new Error("Motion access denied.");
      }
    }
    if ("DeviceOrientationEvent" in window && typeof DeviceOrientationEvent.requestPermission === "function") {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== "granted") {
        throw new Error("Orientation access denied.");
      }
    }
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.diagnostics.wake_lock = "active";
        return;
      }
      state.diagnostics.wake_lock = "fallback audio";
      startNoSleepFallback();
    } catch (error) {
      state.diagnostics.wake_lock = `failed: ${error.message}; fallback audio`;
      log(`Wake lock failed: ${error.message}`);
      startNoSleepFallback();
    }
  }

  function startNoSleepFallback() {
    if (!state.audioCtx || state.noSleep) {
      return;
    }
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start();
    state.noSleep = { osc, gain };
  }

  async function releaseWakeLock() {
    try {
      if (state.wakeLock) {
        await state.wakeLock.release();
      }
    } catch (error) {
      log(`Wake lock release failed: ${error.message}`);
    }
    state.wakeLock = null;
    if (state.noSleep) {
      try {
        state.noSleep.osc.stop();
        state.noSleep.osc.disconnect();
        state.noSleep.gain.disconnect();
      } catch (error) {
        log(`No-sleep fallback release failed: ${error.message}`);
      }
      state.noSleep = null;
    }
  }

  function resetSessionState() {
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
  }

  async function startSession() {
    if (state.phase !== "ready" && state.phase !== "done") {
      return;
    }

    resetSessionState();
    state.diagnostics.session_id = `sixbpm-${Date.now()}`;
    state.diagnostics.started_at = new Date().toISOString();
    state.sessionSettings = currentSettings();
    state.diagnostics.settings = { ...state.sessionSettings };
    state.diagnostics.settings_start = { ...state.sessionSettings };
    state.diagnostics.settings_final = { ...state.sessionSettings };

    try {
      await ensureAudio();
      state.diagnostics.audio_state = state.audioCtx ? state.audioCtx.state : "unavailable";
      await requestMotionPermission();
      state.diagnostics.permission = "granted";
    } catch (error) {
      state.diagnostics.permission = error.message;
      log(error.message);
      setStatus(error.message);
      setSensorStatus(error.message.includes("denied") ? "denied" : "", error.message.includes("denied") ? "Motion access denied" : "Sensor: unavailable");
      return;
    }

    state.phase = "calibrating";
    state.sessionStartMs = performance.now();
    state.calibrationStartMs = state.sessionStartMs;
    els.startButton.disabled = true;
    els.stopButton.disabled = false;
    els.testButton.disabled = true;
    setSessionControlLock(true);
    setPrepVisible(false);
    els.orb.classList.add("calibrating");
    setPhase("calibrating");
    setStatus("Calibrating. Keep the phone still while we find your breathing signal.");
    setSensorStatus("active", "Sensor: active");
    updateStats();
    log("Session started");
    log("Calibration started");

    window.addEventListener("devicemotion", onMotion, { passive: true });
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    startGenericSensor();
    startSensorWatchdog();
    startDebugPanel();
    await requestWakeLock();
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
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stopGenericSensor();
    releaseWakeLock();
    els.orb.classList.remove("calibrating");
    els.orb.style.transform = "scale(1)";
    els.startButton.disabled = false;
    els.stopButton.disabled = true;
    els.testButton.disabled = false;
    setSessionControlLock(false);
    setPrepVisible(true);

    if (completed) {
      state.phase = "done";
      setPhase("done");
      setStatus("Session complete. Sit up slowly. Take BP now if you are tracking it.");
      els.timeRemaining.textContent = "0:00";
      log("Session ended");
      finalizeDiagnostics("completed");
      saveSessionRecord();
    } else if (wasActive) {
      state.phase = "ready";
      setPhase("ready");
      setStatus("Session stopped.");
      log("Session stopped");
      finalizeDiagnostics("stopped");
      updateStats();
    }
  }

  function currentSettings() {
    return {
      ratio: Number(els.ratioSlider.value),
      floor_bpm: Number(els.floorSlider.value)
    };
  }

  function sessionSettings() {
    return state.sessionSettings || currentSettings();
  }

  function setSessionControlLock(locked) {
    els.ratioSlider.disabled = locked;
    els.floorSlider.disabled = locked;
  }

  function recordSettingChange(input) {
    if (!input || !state.sessionStartMs || (state.phase !== "calibrating" && state.phase !== "pacing")) {
      return;
    }
    const keyById = {
      ratioSlider: "ratio",
      floorSlider: "floor_bpm"
    };
    const key = keyById[input.id];
    if (!key) {
      return;
    }
    const value = rounded(Number(input.value));
    const elapsedMs = state.sessionStartMs ? Math.round(performance.now() - state.sessionStartMs) : 0;
    const last = state.diagnostics.settings_changes[state.diagnostics.settings_changes.length - 1];
    if (last && last.key === key && last.value === value) {
      return;
    }
    state.diagnostics.settings_changes.push({
      elapsed_ms: elapsedMs,
      key,
      value
    });
    state.diagnostics.settings_changes = state.diagnostics.settings_changes.slice(-20);
    state.diagnostics.settings_final = currentSettings();
    log(`Setting changed: ${key} ${value}`);
  }

  function finalizeDiagnostics(status) {
    state.diagnostics.ended_at = new Date().toISOString();
    state.diagnostics.status = status;
    state.diagnostics.settings_final = currentSettings();
    state.diagnostics.final_target_bpm = rounded(state.targetBpm);
    state.diagnostics.sync_quality_score = rounded(calculateSyncScore());
    state.diagnostics.calibration_peak_count = state.breathDetector.calibrationPeakCount || state.diagnostics.calibration_peak_count;
    state.diagnostics.pacing_peak_count = state.breathDetector.pacingPeakCount || state.diagnostics.pacing_peak_count;
    try {
      localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(buildReport(), null, 2));
      log("Diagnostic report saved locally");
    } catch (error) {
      log(`Diagnostic save failed: ${error.message}`);
    }
  }

  function saveSessionRecord() {
    const record = {
      ts: new Date().toISOString(),
      baseline_bpm: rounded(state.baselineBpm),
      final_target_bpm: rounded(state.targetBpm),
      breath_count: state.breathCount,
      sync_quality_score: rounded(calculateSyncScore())
    };
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      existing.push(record);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      log("Session saved");
    } catch (error) {
      log(`Session save failed: ${error.message}`);
    }
  }

  function rounded(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  }

  function calculateSyncScore() {
    if (!state.syncSamples.length) {
      return 0;
    }
    const good = state.syncSamples.filter((value) => value <= SYNC_DIVERGENCE_BPM).length;
    return (good / state.syncSamples.length) * 100;
  }

  function tickSession() {
    const now = performance.now();
    if (document.visibilityState !== "visible" && (state.phase === "calibrating" || state.phase === "pacing")) {
      setStatus("Keep this page visible during the session.");
      updateStats();
      return;
    }
    const elapsed = now - state.sessionStartMs;
    updateStats();
    if (elapsed >= SESSION_MS) {
      finishSession(true);
      return;
    }
    if (state.phase === "calibrating" && now - state.calibrationStartMs >= CALIBRATION_MS) {
      if (!calibrationReady(now)) {
        setStatus("Calibrating. Waiting for a cleaner breathing signal.");
        return;
      }
      beginPacing();
    }
  }

  function calibrationReady(now) {
    if (!state.axisName) {
      return false;
    }
    if (now - state.axisSelectedMs < 25000) {
      return false;
    }
    return state.breathDetector.peaks.length >= 2 || now - state.calibrationStartMs >= 90000;
  }

  function beginPacing() {
    const measured = state.breathDetector.currentBpm;
    const fallback = estimateCalibrationBpm();
    const rawBaseline = Number.isFinite(measured) ? measured : Number.isFinite(fallback) ? fallback : 12;
    const baseline = clamp(rawBaseline || 12, 6, 18);
    const baselineSource = Number.isFinite(measured) ? "detected rolling BPM" : Number.isFinite(fallback) ? "detected calibration peaks" : "fallback 12 BPM, not enough peaks";
    const floor = sessionSettings().floor_bpm;

    state.baselineBpm = Math.max(floor, baseline);
    state.targetBpm = Math.max(floor, state.baselineBpm - 1);
    state.phase = "pacing";
    els.orb.classList.remove("calibrating");
    state.diagnostics.baseline_source = baselineSource;
    state.diagnostics.baseline_bpm = rounded(state.baselineBpm);
    state.diagnostics.target_start_bpm = rounded(state.targetBpm);
    setStatus(baselineSource.includes("fallback") ? "Pacing started with fallback baseline; sensor data was weak." : "Follow the tones.");
    setPhase("inhale");
    log(`Baseline ${baselineSource}: ${state.baselineBpm.toFixed(1)} BPM`);
    if (rawBaseline !== baseline) {
      log(`Raw detected baseline ${rawBaseline.toFixed(1)} BPM clamped to ${baseline.toFixed(1)} BPM`);
    }
    log(`Pacing starting at ${state.targetBpm.toFixed(1)} BPM`);

    state.nextCycleAudioTime = state.audioCtx.currentTime + 0.25;
    scheduleNextCycle();
    state.schedulerTimer = window.setInterval(scheduleAhead, 250);
    animateOrb();
  }

  function scheduleAhead() {
    if (state.phase !== "pacing") {
      return;
    }
    while (state.nextCycleAudioTime < state.audioCtx.currentTime + 2.5) {
      scheduleNextCycle();
    }
  }

  function scheduleNextCycle() {
    const settings = sessionSettings();
    const target = state.targetBpm || settings.floor_bpm;
    const cycleSeconds = 60 / target;
    const ratio = settings.ratio;
    const inhaleSeconds = cycleSeconds / (1 + ratio);
    const exhaleSeconds = cycleSeconds - inhaleSeconds;
    const startAt = state.nextCycleAudioTime;
    const startMs = performance.now() + Math.max(0, (startAt - state.audioCtx.currentTime) * 1000);
    const expectedPeakMs = startMs + inhaleSeconds * 1000;

    state.breathCount += 1;
    const cycle = {
      id: state.breathCount,
      startMs,
      ms: expectedPeakMs,
      target,
      hasPeak: false,
      detectedBpm: null,
      divergence: null,
      timingDeltaMs: null,
      evaluated: false
    };
    state.scheduledInhales.push(cycle);
    state.scheduledInhales = state.scheduledInhales.filter((scheduled) => startMs - scheduled.startMs < 90000).slice(-18);
    const visual = {
      startAudio: startAt,
      inhaleSeconds,
      exhaleSeconds,
      cycleSeconds
    };
    state.diagnostics.pacing_cycles = state.breathCount;

    scheduleTone(startAt, inhaleSeconds, 330, 523);
    scheduleTone(startAt + inhaleSeconds, exhaleSeconds, 523, 220);
    scheduleTimeout(() => {
      state.currentVisual = visual;
      setPhase("inhale");
    }, Math.max(0, (startAt - state.audioCtx.currentTime) * 1000));
    scheduleTimeout(() => setPhase("exhale"), Math.max(0, (startAt + inhaleSeconds - state.audioCtx.currentTime) * 1000));
    scheduleTimeout(() => evaluateDescent(cycle), Math.max(0, (startAt + cycleSeconds - state.audioCtx.currentTime) * 1000));

    state.nextCycleAudioTime += cycleSeconds;
  }

  function scheduleTone(startAt, duration, startFreq, endFreq) {
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    const peak = 1;
    osc.type = "sine";
    osc.frequency.setValueAtTime(startFreq, startAt);
    osc.frequency.linearRampToValueAtTime(endFreq, startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + duration * 0.22);
    gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(state.masterGain);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  function evaluateDescent(cycle) {
    if (state.phase !== "pacing" || !state.targetBpm || !cycle || cycle.evaluated) {
      return;
    }
    cycle.evaluated = true;
    const floor = sessionSettings().floor_bpm;
    const sensorActive = !state.diagnostics.pacer_only_mode;

    if (sensorActive && !cycle.hasPeak) {
      state.missedCycleStreak += 1;
      state.diagnostics.missed_cycle_count += 1;
      state.diagnostics.sync_miss_count += 1;
      state.syncSamples.push(SYNC_DIVERGENCE_BPM + 1);
      state.syncSamples = state.syncSamples.slice(-80);
      if (state.missedCycleStreak >= SENSOR_WEAK_STREAK && !state.weakSensorNoticeShown) {
        state.weakSensorNoticeShown = true;
        setStatus("Sensor signal is weak. Keep following the tones.");
        log("Sensor signal weak; pacer descent will continue");
      }
    } else if (cycle.hasPeak) {
      state.missedCycleStreak = 0;
    }

    const detectedFast = sensorActive && cycle.hasPeak && Number.isFinite(cycle.detectedBpm) && cycle.detectedBpm > cycle.target + SYNC_DIVERGENCE_BPM;
    state.fastBreathStreak = detectedFast ? state.fastBreathStreak + 1 : 0;
    state.syncMisses = state.fastBreathStreak;

    if (state.fastBreathStreak >= FAST_BREATH_HOLD_STREAK) {
      state.diagnostics.hold_count += 1;
      state.diagnostics.fast_breath_hold_count += 1;
      setStatus("Holding pace; your breathing is still faster than the target.");
      log(`Holding at ${state.targetBpm.toFixed(1)} BPM; detected ${cycle.detectedBpm.toFixed(1)} BPM`);
      return;
    }

    if (state.targetBpm > floor) {
      state.targetBpm = Math.max(floor, state.targetBpm - DESCENT_PER_CYCLE);
      if (cycle.hasPeak) {
        state.diagnostics.sensor_assisted_descent_count += 1;
      } else {
        state.diagnostics.pacer_descent_count += 1;
      }
      if (!state.weakSensorNoticeShown) {
        setStatus("Follow the tones. Inhale as the orb grows; exhale as it softens.");
      }
    }
  }

  function animateOrb() {
    if (state.phase !== "pacing") {
      return;
    }
    const visual = state.currentVisual;
    if (visual) {
      const audioNow = state.audioCtx.currentTime;
      const elapsed = audioNow - visual.startAudio;
      let scale = 1;
      if (elapsed >= 0 && elapsed <= visual.inhaleSeconds) {
        scale = 1 + 1.2 * easeInOut(elapsed / visual.inhaleSeconds);
      } else if (elapsed > visual.inhaleSeconds && elapsed <= visual.cycleSeconds) {
        const exhaleProgress = (elapsed - visual.inhaleSeconds) / visual.exhaleSeconds;
        scale = 2.2 - 1.2 * easeInOut(exhaleProgress);
      }
      els.orb.style.transform = `scale(${scale.toFixed(3)})`;
    }
    state.rafId = window.requestAnimationFrame(animateOrb);
  }

  function easeInOut(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
  }

  function onMotion(event) {
    const a = event.accelerationIncludingGravity || event.acceleration;
    if (!a) {
      return;
    }
    const now = performance.now();
    recordSensorEvent("motion", now);
    processSensorSample({
      t: now,
      source: "motion",
      x: Number(a.x),
      y: Number(a.y),
      z: Number(a.z)
    });
    updateDebugSample("motion", { x: Number(a.x), y: Number(a.y), z: Number(a.z) });
  }

  function onVisibilityChange() {
    const now = performance.now();
    const entry = {
      state: document.visibilityState,
      elapsed_ms: state.sessionStartMs ? Math.round(now - state.sessionStartMs) : null
    };
    state.diagnostics.visibility_state = document.visibilityState;
    state.diagnostics.visibility_changes.push(entry);
    state.diagnostics.visibility_changes = state.diagnostics.visibility_changes.slice(-20);
    log(`Visibility: ${document.visibilityState}`);

    if (document.visibilityState !== "visible" && (state.phase === "calibrating" || state.phase === "pacing")) {
      state.hiddenStartMs = now;
      setStatus("Session paused. Keep this page visible during the session.");
      return;
    }

    if (state.hiddenStartMs && (state.phase === "calibrating" || state.phase === "pacing")) {
      const hiddenMs = now - state.hiddenStartMs;
      state.sessionStartMs += hiddenMs;
      state.calibrationStartMs += hiddenMs;
      if (state.phase === "pacing" && state.audioCtx && state.nextCycleAudioTime) {
        state.nextCycleAudioTime = Math.max(state.nextCycleAudioTime, state.audioCtx.currentTime + 0.25);
      }
      state.diagnostics.hidden_pause_ms += Math.round(hiddenMs);
      state.hiddenStartMs = 0;
      setStatus(state.phase === "calibrating" ? "Calibration resumed." : "Session resumed.");
      log(`Session clock paused for ${(hiddenMs / 1000).toFixed(1)}s while hidden`);
    }
  }

  function startGenericSensor() {
    const SensorCtor = window.LinearAccelerationSensor || window.Accelerometer || window.GravitySensor;
    if (!SensorCtor) {
      state.diagnostics.generic_sensor_status = "unsupported";
      return;
    }
    try {
      const sensor = new SensorCtor({ frequency: 30 });
      state.genericSensor = sensor;
      sensor.addEventListener("reading", () => {
        const now = performance.now();
        recordSensorEvent("generic", now);
        processSensorSample({
          t: now,
          source: "generic",
          x: Number(sensor.x),
          y: Number(sensor.y),
          z: Number(sensor.z)
        });
        updateDebugSample("generic", { x: Number(sensor.x), y: Number(sensor.y), z: Number(sensor.z) });
      });
      sensor.addEventListener("error", (event) => {
        const message = event.error && event.error.message ? event.error.message : "unknown error";
        state.diagnostics.generic_sensor_status = `error: ${message}`;
        if (message.toLowerCase().includes("permission")) {
          setSensorHelp("Browser denied sensor access. In Chrome, open site settings for this page and allow motion sensors. In Brave, disable Shields or allow motion sensors for this site.");
        }
        log(`Generic sensor error: ${message}`);
      });
      sensor.start();
      state.diagnostics.generic_sensor_status = SensorCtor.name || "started";
      log(`Generic sensor started: ${state.diagnostics.generic_sensor_status}`);
    } catch (error) {
      state.diagnostics.generic_sensor_status = `failed: ${error.message}`;
      log(`Generic sensor failed: ${error.message}`);
    }
  }

  function stopGenericSensor() {
    if (!state.genericSensor) {
      return;
    }
    try {
      state.genericSensor.stop();
    } catch (error) {
      log(`Generic sensor stop failed: ${error.message}`);
    }
    state.genericSensor = null;
  }

  function onOrientation(event) {
    if (!Number.isFinite(event.beta) && !Number.isFinite(event.gamma) && !Number.isFinite(event.alpha)) {
      return;
    }
    const now = performance.now();
    recordSensorEvent("orientation", now);
    processSensorSample({
      t: now,
      source: "orientation",
      beta: Number(event.beta),
      gamma: Number(event.gamma),
      alpha: Number(event.alpha)
    });
    updateDebugSample("orientation", { beta: Number(event.beta), gamma: Number(event.gamma), alpha: Number(event.alpha) });
  }

  function processSensorSample(sample) {
    if (!state.axisName) {
      state.axisSamples.push(sample);
      const elapsed = sample.t - state.calibrationStartMs;
      if (elapsed >= AXIS_PICK_MS) {
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

    if (sample.source !== state.axisSource || !Number.isFinite(sample[state.axisName])) {
      return;
    }
    const peak = state.breathDetector.addSample(sample.t, sample[state.axisName]);
    if (peak) {
      handleDetectedBreath(peak);
    }
  }

  function handleDetectedBreath(peak) {
    if (state.phase === "calibrating") {
      state.diagnostics.calibration_peak_count += 1;
    }
    if (state.phase === "pacing") {
      state.diagnostics.pacing_peak_count += 1;
    }
    updateStats();
    if (state.phase === "pacing") {
      const match = nearestScheduledInhale(peak.t);
      if (match) {
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
        if (divergence > SYNC_DIVERGENCE_BPM) {
          state.diagnostics.sync_miss_count += 1;
        } else if (!state.weakSensorNoticeShown) {
          setStatus("Follow the tones.");
        }
      }
    }
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
    for (const id of state.timeouts) {
      window.clearTimeout(id);
    }
    state.timeouts = [];
  }

  function startDebugPanel() {
    updateDebugPanel();
    state.debugTimer = window.setInterval(updateDebugPanel, 250);
  }

  function updateDebugPanel() {
    if (!els.debugLine) {
      return;
    }
    const lastTimes = [state.diagnostics.last_motion_ms, state.diagnostics.last_orientation_ms, state.diagnostics.last_generic_sensor_ms].filter(Number.isFinite);
    const lastElapsed = lastTimes.length ? Math.max(...lastTimes) : null;
    const nowElapsed = state.sessionStartMs ? Math.round(performance.now() - state.sessionStartMs) : 0;
    const gap = lastElapsed === null ? "none" : `${((nowElapsed - lastElapsed) / 1000).toFixed(1)}s`;
    els.debugLine.textContent = `Sensor debug: motion ${state.diagnostics.motion_events}, orientation ${state.diagnostics.orientation_events}, generic ${state.diagnostics.generic_sensor_events}, gap ${gap}, visible ${document.visibilityState}`;
  }

  function updateDebugSample(source, values) {
    if (!els.debugSample) {
      return;
    }
    const parts = Object.keys(values).map((key) => `${key}:${Number.isFinite(values[key]) ? values[key].toFixed(2) : "null"}`);
    els.debugSample.textContent = `Last sample: ${source} ${parts.join(" ")}`;
  }

  function setSensorHelp(message) {
    state.diagnostics.sensor_help = message;
    state.diagnostics.sensor_warning = message;
    setSensorStatus("denied", "Sensor: permission blocked");
    setStatus(message);
  }

  function recordSensorEvent(kind, now) {
    const elapsed = Math.round(now - state.sessionStartMs);
    if (kind === "motion") {
      state.diagnostics.motion_events += 1;
      if (state.diagnostics.first_motion_ms === null) {
        state.diagnostics.first_motion_ms = elapsed;
      }
      state.diagnostics.last_motion_ms = elapsed;
      const span = state.diagnostics.last_motion_ms - state.diagnostics.first_motion_ms;
      if (span > 1000) {
        state.diagnostics.motion_hz_estimate = rounded((state.diagnostics.motion_events - 1) / (span / 1000));
      }
      return;
    }
    if (kind === "orientation") {
      state.diagnostics.orientation_events += 1;
      if (state.diagnostics.first_orientation_ms === null) {
        state.diagnostics.first_orientation_ms = elapsed;
      }
      state.diagnostics.last_orientation_ms = elapsed;
      const span = state.diagnostics.last_orientation_ms - state.diagnostics.first_orientation_ms;
      if (span > 1000) {
        state.diagnostics.orientation_hz_estimate = rounded((state.diagnostics.orientation_events - 1) / (span / 1000));
      }
      return;
    }
    state.diagnostics.generic_sensor_events += 1;
    if (state.diagnostics.first_generic_sensor_ms === null) {
      state.diagnostics.first_generic_sensor_ms = elapsed;
    }
    state.diagnostics.last_generic_sensor_ms = elapsed;
    const span = state.diagnostics.last_generic_sensor_ms - state.diagnostics.first_generic_sensor_ms;
    if (span > 1000) {
      state.diagnostics.generic_sensor_hz_estimate = rounded((state.diagnostics.generic_sensor_events - 1) / (span / 1000));
    }
  }

  function startSensorWatchdog() {
    state.sensorWatchdogTimer = window.setInterval(() => {
      if (state.phase !== "calibrating" && state.phase !== "pacing") {
        return;
      }
      const total = state.diagnostics.motion_events + state.diagnostics.orientation_events + state.diagnostics.generic_sensor_events;
      if (total < 5 && performance.now() - state.sessionStartMs > 8000) {
        if (!state.diagnostics.sensor_help) {
          setSensorHelp("Sensor events are blocked. Try regular Chrome, enable motion sensors in site settings, or disable Brave Shields for this site.");
        }
        state.diagnostics.pacer_only_mode = true;
        state.syncMisses = 0;
        setSensorStatus("denied", "Sensor: pacer-only mode");
        setStatus("Sensor blocked. Continuing as a pacer without breath detection.");
        log(`Sensor warning: only ${total} sensor events after 8 seconds; pacer-only mode`);
        window.clearInterval(state.sensorWatchdogTimer);
      }
    }, 4000);
  }

  function nearestScheduledInhale(ms) {
    if (!state.scheduledInhales.length) {
      return null;
    }
    let best = null;
    for (const cycle of state.scheduledInhales) {
      if (cycle.evaluated) {
        continue;
      }
      const delta = Math.abs(cycle.ms - ms);
      if (!best || delta < best.delta) {
        best = { cycle, delta };
      }
    }
    if (!best) {
      return null;
    }
    const windowMs = syncWindowMs(best.cycle.target);
    return best.delta <= windowMs ? best : null;
  }

  function syncWindowMs(targetBpm) {
    const cycleMs = 60000 / clamp(targetBpm || 6, 4, 24);
    return clamp(cycleMs * 0.45, 3500, 6500);
  }

  function estimateCalibrationBpm() {
    const peaks = state.breathDetector.peaks;
    if (peaks.length >= 2) {
      const intervals = [];
      for (let i = 1; i < peaks.length; i += 1) {
        intervals.push((peaks[i] - peaks[i - 1]) / 1000);
      }
      return 60 / median(intervals.slice(-4));
    }
    return NaN;
  }

  function pickRespirationAxis(samples) {
    const accelerationCandidates = scoreAxisCandidates(samples, [
      { source: "generic", axis: "z" },
      { source: "generic", axis: "y" },
      { source: "generic", axis: "x" },
      { source: "motion", axis: "z" },
      { source: "motion", axis: "y" },
      { source: "motion", axis: "x" }
    ]);
    const orientationCandidates = scoreAxisCandidates(samples, [
      { source: "orientation", axis: "beta" },
      { source: "orientation", axis: "gamma" }
    ]);
    const all = accelerationCandidates.concat(orientationCandidates);
    const powers = {};
    for (const candidate of all) {
      powers[`${candidate.source}.${candidate.axis}`] = rounded(candidate.power) || 0;
    }

    const bestAcceleration = bestCandidate(accelerationCandidates);
    const bestOrientation = bestCandidate(orientationCandidates);
    if (bestOrientation && (!bestAcceleration || bestOrientation.power > bestAcceleration.power * 8)) {
      return { axis: bestOrientation.axis, source: bestOrientation.source, powers, sampleRate: bestOrientation.sampleRate };
    }
    if (bestAcceleration && bestAcceleration.power > 0.0005) {
      return { axis: bestAcceleration.axis, source: bestAcceleration.source, powers, sampleRate: bestAcceleration.sampleRate };
    }

    if (bestOrientation) {
      return { axis: bestOrientation.axis, source: bestOrientation.source, powers, sampleRate: bestOrientation.sampleRate };
    }

    return { axis: "z", source: "generic", powers, sampleRate: 30 };
  }

  function scoreAxisCandidates(samples, candidates) {
    return candidates.map((candidate) => {
      const usable = samples.filter((sample) => sample.source === candidate.source && Number.isFinite(sample[candidate.axis]));
      if (usable.length < 20) {
        return { ...candidate, power: 0, count: usable.length };
      }
      const values = usable.map((sample) => sample[candidate.axis]);
      const sampleRate = estimateSampleRate(usable);
      const filtered = offlineBandpass(values, sampleRate);
      return { ...candidate, power: variance(filtered), count: usable.length, sampleRate };
    });
  }

  function bestCandidate(candidates) {
    return candidates.reduce((best, candidate) => {
      if (!best || candidate.power > best.power) {
        return candidate;
      }
      return best;
    }, null);
  }

  function formatPowers(powers) {
    return Object.keys(powers).sort().map((axis) => `${axis}=${powers[axis].toFixed(5)}`).join(", ") || "none";
  }

  function estimateSampleRate(samples) {
    if (samples.length < 2) {
      return 30;
    }
    const elapsedSeconds = (samples[samples.length - 1].t - samples[0].t) / 1000;
    if (elapsedSeconds <= 0) {
      return 30;
    }
    return clamp((samples.length - 1) / elapsedSeconds, 5, 60);
  }

  function offlineBandpass(values, sampleRate) {
    const filter = createBiquadBandpass(sampleRate);
    return values.map((value) => filter(value));
  }

  function createBreathDetector() {
    const detector = {
      filter: createBiquadBandpass(30),
      axis: null,
      values: [],
      peaks: [],
      lastPeakMs: 0,
      currentBpm: null,
      rejectedPeakCount: 0,
      setAxis(axis, sampleRate) {
        this.axis = axis;
        this.filter = createBiquadBandpass(sampleRate || 30);
        this.values = [];
        this.peaks = [];
        this.lastPeakMs = 0;
        this.currentBpm = null;
      },
      addSample(t, value) {
        if (!this.axis) {
          return null;
        }
        const y = this.filter(value);
        this.values.push({ t, y });
        this.values = this.values.slice(-180);
        if (this.values.length < 25) {
          return null;
        }
        const midIndex = this.values.length - 10;
        const mid = this.values[midIndex];
        const leftWindow = this.values.slice(Math.max(0, midIndex - 10), midIndex);
        const rightWindow = this.values.slice(midIndex + 1, Math.min(this.values.length, midIndex + 11));
        const recent = this.values.slice(-120).map((sample) => sample.y);
        const noise = standardDeviation(recent);
        const floor = Math.max(0.01, noise * 0.35);
        const leftMax = Math.max(...leftWindow.map((sample) => sample.y));
        const rightMax = Math.max(...rightWindow.map((sample) => sample.y));
        const isPeak = mid.y >= leftMax && mid.y >= rightMax && Math.abs(mid.y) > floor;
        if (!isPeak) {
          return null;
        }
        const intervalMs = this.lastPeakMs ? mid.t - this.lastPeakMs : null;
        if (intervalMs !== null && intervalMs < REFRACTORY_MS) {
          this.rejectedPeakCount += 1;
          state.diagnostics.rejected_peak_count = this.rejectedPeakCount;
          return null;
        }
        if (intervalMs !== null && intervalMs > 20000) {
          this.peaks = [];
          this.currentBpm = null;
        }
        this.lastPeakMs = mid.t;
        this.peaks.push(mid.t);
        this.peaks = this.peaks.slice(-12);
        if (this.peaks.length >= 2) {
          const intervals = [];
          for (let i = Math.max(1, this.peaks.length - 4); i < this.peaks.length; i += 1) {
            const seconds = (this.peaks[i] - this.peaks[i - 1]) / 1000;
            if (seconds >= 2.5 && seconds <= 15) {
              intervals.push(seconds);
            }
          }
          if (intervals.length) {
            this.currentBpm = clamp(60 / median(intervals), 4, 24);
          }
        }
        return mid;
      }
    };
    return detector;
  }

  function createBiquadBandpass(sampleRate) {
    const fs = clamp(sampleRate || 30, 5, 60);
    const centerHz = 0.25;
    const q = 0.7;
    const omega = 2 * Math.PI * centerHz / fs;
    const alpha = Math.sin(omega) / (2 * q);
    const cos = Math.cos(omega);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b1 = 0;
    const b2 = -alpha / a0;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    return function filter(x0) {
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      return y0;
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function standardDeviation(values) {
    if (!values.length) {
      return 0;
    }
    return Math.sqrt(variance(values));
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) {
      return NaN;
    }
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function variance(values) {
    if (!values.length) {
      return 0;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  }

  function buildReport() {
    const elapsedMs = state.sessionStartMs ? Math.round(performance.now() - state.sessionStartMs) : null;
    const calibrationRemainingMs = state.phase === "calibrating" && elapsedMs !== null ? Math.max(0, CALIBRATION_MS - elapsedMs) : 0;
    return {
      diagnostics: state.diagnostics,
      current: {
        phase: state.phase,
        elapsed_ms: elapsedMs,
        calibration_remaining_ms: calibrationRemainingMs,
        report_note: reportNote(elapsedMs),
        target_bpm: rounded(state.targetBpm),
        user_bpm: rounded(state.breathDetector.currentBpm),
        peaks: state.breathDetector.peaks.map((t) => Math.round(t - state.sessionStartMs)).slice(-12),
        session_log_text: els.sessionLog.textContent
      }
    };
  }

  function reportNote(elapsedMs) {
    if (state.phase === "calibrating") {
      return `Still calibrating. Wait ${Math.ceil(Math.max(0, CALIBRATION_MS - (elapsedMs || 0)) / 1000)} more seconds before judging breath detection.`;
    }
    if (state.phase === "pacing" && elapsedMs !== null && elapsedMs < 90000) {
      return "Pacing has started. For a useful report, let it run another minute if possible.";
    }
    return "Report captured.";
  }

  async function copyReport() {
    const reportObject = buildReport();
    const report = JSON.stringify(reportObject, null, 2);
    els.reportText.value = report;
    els.reportSection.hidden = false;
    els.reportText.focus();
    els.reportText.select();

    try {
      localStorage.setItem(REPORT_STORAGE_KEY, report);
    } catch (error) {
      log(`Diagnostic save failed: ${error.message}`);
    }

    try {
      if (!navigator.clipboard || !window.isSecureContext) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(report);
      setStatus(reportObject.current.report_note);
      log("Diagnostic report copied");
    } catch (error) {
      setStatus("Report is shown below. Select it and copy manually.");
      log(`Clipboard copy blocked: ${error.message}`);
    }
  }

  async function testTones() {
    try {
      await ensureAudio();
    } catch (error) {
      state.diagnostics.permission = error.message;
      log(error.message);
      setStatus(error.message);
      return;
    }
    const settings = currentSettings();
    const target = settings.floor_bpm;
    const cycleSeconds = 60 / target;
    const ratio = settings.ratio;
    const inhaleSeconds = cycleSeconds / (1 + ratio);
    const exhaleSeconds = cycleSeconds - inhaleSeconds;
    const startAt = state.audioCtx.currentTime + 0.1;
    scheduleTone(startAt, inhaleSeconds, 330, 523);
    scheduleTone(startAt + inhaleSeconds, exhaleSeconds, 523, 220);
    state.currentVisual = { startAudio: startAt, inhaleSeconds, exhaleSeconds, cycleSeconds };
    state.phase = "pacing";
    setPrepVisible(false);
    animateOrb();
    setStatus("Testing one breath cycle. Use your phone volume buttons to adjust loudness.");
    log("Test tone cycle started");
    scheduleTimeout(() => setPhase("inhale"), 100);
    scheduleTimeout(() => setPhase("exhale"), 100 + inhaleSeconds * 1000);
    scheduleTimeout(() => {
      state.phase = "ready";
      setPrepVisible(true);
      window.cancelAnimationFrame(state.rafId);
      els.orb.style.transform = "scale(1)";
      setPhase("ready");
      setStatus("Ready.");
    }, (cycleSeconds + 0.2) * 1000);
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js?v=cache-v26").catch((error) => {
        log(`Service worker registration failed: ${error.message}`);
      });
    }
  }

  function init() {
    updateSliderLabels();
    els.versionLabel.textContent = `Version: ${APP_VERSION}`;
    setPhase("ready");
    updateStats();
    els.ratioSlider.addEventListener("input", handleSettingInput);
    els.floorSlider.addEventListener("input", handleSettingInput);
    els.ratioSlider.addEventListener("change", handleSettingChange);
    els.floorSlider.addEventListener("change", handleSettingChange);
    els.startButton.addEventListener("click", startSession);
    els.stopButton.addEventListener("click", stopSession);
    els.testButton.addEventListener("click", testTones);
    els.copyReportButton.addEventListener("click", copyReport);
    registerServiceWorker();
    log(`App ready (${APP_VERSION})`);
  }

  init();
}());
