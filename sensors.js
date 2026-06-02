import { rounded, sensorFallbackDecision } from "./state.js";

export async function requestMotionPermission() {
  if (!("DeviceMotionEvent" in window)) throw new Error("Device motion is not supported.");
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    const result = await DeviceMotionEvent.requestPermission();
    if (result !== "granted") throw new Error("Motion access denied.");
  }
  if ("DeviceOrientationEvent" in window && typeof DeviceOrientationEvent.requestPermission === "function") {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result !== "granted") throw new Error("Orientation access denied.");
  }
}

export function recordSensorEvent(diagnostics, kind, now, sessionStartMs) {
  const elapsed = Math.round(now - sessionStartMs);
  const map = {
    motion: ["motion_events", "first_motion_ms", "last_motion_ms", "motion_hz_estimate"],
    orientation: ["orientation_events", "first_orientation_ms", "last_orientation_ms", "orientation_hz_estimate"],
    generic: ["generic_sensor_events", "first_generic_sensor_ms", "last_generic_sensor_ms", "generic_sensor_hz_estimate"]
  };
  const [countKey, firstKey, lastKey, hzKey] = map[kind];
  diagnostics[countKey] += 1;
  if (diagnostics[firstKey] === null) diagnostics[firstKey] = elapsed;
  diagnostics[lastKey] = elapsed;
  const span = diagnostics[lastKey] - diagnostics[firstKey];
  if (span > 1000) diagnostics[hzKey] = rounded((diagnostics[countKey] - 1) / (span / 1000));
}

export function createSensorController({ state, processSample, updateDebugSample, setSensorHelp, log }) {
  let genericSensor = null;

  function onMotion(event) {
    const a = event.accelerationIncludingGravity || event.acceleration;
    if (!a) return;
    const now = performance.now();
    recordSensorEvent(state.diagnostics, "motion", now, state.sessionStartMs);
    const sample = { t: now, source: "motion", x: Number(a.x), y: Number(a.y), z: Number(a.z) };
    processSample(sample);
    updateDebugSample("motion", { x: sample.x, y: sample.y, z: sample.z });
  }

  function onOrientation(event) {
    if (!Number.isFinite(event.beta) && !Number.isFinite(event.gamma) && !Number.isFinite(event.alpha)) return;
    const now = performance.now();
    recordSensorEvent(state.diagnostics, "orientation", now, state.sessionStartMs);
    const sample = { t: now, source: "orientation", beta: Number(event.beta), gamma: Number(event.gamma), alpha: Number(event.alpha) };
    processSample(sample);
    updateDebugSample("orientation", { beta: sample.beta, gamma: sample.gamma, alpha: sample.alpha });
  }

  function startGenericSensor() {
    const SensorCtor = window.LinearAccelerationSensor || window.Accelerometer || window.GravitySensor;
    if (!SensorCtor) {
      state.diagnostics.generic_sensor_status = "unsupported";
      return;
    }
    try {
      genericSensor = new SensorCtor({ frequency: 30 });
      genericSensor.addEventListener("reading", () => {
        const now = performance.now();
        recordSensorEvent(state.diagnostics, "generic", now, state.sessionStartMs);
        const sample = { t: now, source: "generic", x: Number(genericSensor.x), y: Number(genericSensor.y), z: Number(genericSensor.z) };
        processSample(sample);
        updateDebugSample("generic", { x: sample.x, y: sample.y, z: sample.z });
      });
      genericSensor.addEventListener("error", (event) => {
        const message = event.error && event.error.message ? event.error.message : "unknown error";
        state.diagnostics.generic_sensor_status = `error: ${message}`;
        if (message.toLowerCase().includes("permission")) {
          setSensorHelp(sensorFallbackDecision({ totalEvents: 0, elapsedMs: 9000, genericSensorStatus: message }).message);
        }
        log(`Generic sensor error: ${message}`);
      });
      genericSensor.start();
      state.diagnostics.generic_sensor_status = SensorCtor.name || "started";
      log(`Generic sensor started: ${state.diagnostics.generic_sensor_status}`);
    } catch (error) {
      state.diagnostics.generic_sensor_status = `failed: ${error.message}`;
      log(`Generic sensor failed: ${error.message}`);
    }
  }

  return {
    start() {
      window.addEventListener("devicemotion", onMotion, { passive: true });
      window.addEventListener("deviceorientation", onOrientation, { passive: true });
      startGenericSensor();
    },
    stop() {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation);
      if (genericSensor) {
        try { genericSensor.stop(); } catch (error) { log(`Generic sensor stop failed: ${error.message}`); }
        genericSensor = null;
      }
    }
  };
}
