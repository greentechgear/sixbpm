import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESETS,
  applyPreset,
  calculateSyncScore,
  cycleTiming,
  descentDecision,
  formatTime,
  inferPreset,
  sensorFallbackDecision,
  syncWindowMs,
  validateSettings
} from "../state.js";

test("formatTime clamps and rounds up", () => {
  assert.equal(formatTime(15 * 60 * 1000), "15:00");
  assert.equal(formatTime(1001), "0:02");
  assert.equal(formatTime(-10), "0:00");
});

test("ratio and bounds reject unsafe inputs", () => {
  assert.equal(validateSettings({ ratio: 2, floor_bpm: 6, duration_minutes: 15 }).ok, true);
  assert.equal(validateSettings({ ratio: 2.5, floor_bpm: 6, duration_minutes: 15 }).ok, false);
  assert.equal(validateSettings({ ratio: 0.5, floor_bpm: 6, duration_minutes: 15 }).ok, false);
  assert.equal(validateSettings({ ratio: 1.5, floor_bpm: 4, duration_minutes: 15 }).ok, false);
  assert.equal(validateSettings({ ratio: 1.5, floor_bpm: 6, duration_minutes: 30 }).ok, false);
});

test("presets produce expected timing", () => {
  const balanced = applyPreset("balanced");
  assert.equal(inferPreset(balanced), "balanced");
  assert.equal(cycleTiming(6, balanced.ratio).inhaleSeconds, 5);
  assert.equal(cycleTiming(6, balanced.ratio).exhaleSeconds, 5);

  const calm = applyPreset("calm");
  assert.equal(calm.duration_minutes, 15);
  assert.equal(Number(cycleTiming(6, calm.ratio).inhaleSeconds.toFixed(1)), 3.3);
  assert.equal(Number(cycleTiming(6, calm.ratio).exhaleSeconds.toFixed(1)), 6.7);

  const extended = applyPreset("extended");
  assert.equal(extended.duration_minutes, 20);
  assert.equal(Number(cycleTiming(6, extended.ratio).exhaleSeconds.toFixed(1)), 6.7);
});

test("sync scoring and descent decisions are deterministic", () => {
  assert.equal(calculateSyncScore([]), 0);
  assert.equal(calculateSyncScore([0.5, 2, 2.1, 5]), 50);
  assert.equal(syncWindowMs(6), 4500);
  assert.deepEqual(descentDecision({ targetBpm: 8, floorBpm: 6, cycleHasPeak: true, detectedBpm: 8, fastBreathStreak: 0 }).action, "descend");
  assert.deepEqual(descentDecision({ targetBpm: 8, floorBpm: 6, cycleHasPeak: true, detectedBpm: 12, fastBreathStreak: 2 }).action, "hold");
});

test("sensor fallback distinguishes blocked streams", () => {
  assert.equal(sensorFallbackDecision({ totalEvents: 10, elapsedMs: 9000 }).pacerOnly, false);
  const blocked = sensorFallbackDecision({ totalEvents: 1, elapsedMs: 9001, genericSensorStatus: "Permissions to access sensor are not granted" });
  assert.equal(blocked.pacerOnly, true);
  assert.match(blocked.message, /denied sensor access/i);
});
