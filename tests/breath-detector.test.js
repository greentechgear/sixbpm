import test from "node:test";
import assert from "node:assert/strict";
import { createBreathDetector, estimateCalibrationBpm, pickRespirationAxis } from "../breath-detector.js";

test("axis selection prefers dominant safe orientation axis over alpha", () => {
  const samples = [];
  for (let i = 0; i < 120; i += 1) {
    const t = i * 100;
    samples.push({ t, source: "orientation", beta: Math.sin(i / 8) * 10, gamma: Math.sin(i / 9), alpha: Math.sin(i / 2) * 100 });
    samples.push({ t, source: "motion", x: 0.01, y: 0.02, z: 0.01 });
  }
  const result = pickRespirationAxis(samples);
  assert.equal(result.source, "orientation");
  assert.equal(result.axis, "beta");
});

test("breath detector accepts slow synthetic peaks", () => {
  const detector = createBreathDetector();
  detector.setAxis("z", 30);
  for (let i = 0; i < 30 * 50; i += 1) {
    const t = i * (1000 / 30);
    const seconds = t / 1000;
    detector.addSample(t, Math.sin((2 * Math.PI * seconds) / 6));
  }
  assert.ok(detector.peaks.length >= 4);
  assert.ok(detector.currentBpm >= 8 && detector.currentBpm <= 12);
});

test("calibration BPM uses recent median intervals", () => {
  const peaks = [0, 6000, 12000, 18000, 24000];
  assert.equal(estimateCalibrationBpm(peaks), 10);
});
