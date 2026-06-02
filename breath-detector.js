import { clamp, rounded, TIMING } from "./state.js";

export function variance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

export function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function createBiquadBandpass(sampleRate) {
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

export function estimateSampleRate(samples) {
  if (samples.length < 2) return 30;
  const elapsedSeconds = (samples[samples.length - 1].t - samples[0].t) / 1000;
  if (elapsedSeconds <= 0) return 30;
  return clamp((samples.length - 1) / elapsedSeconds, 5, 60);
}

function offlineBandpass(values, sampleRate) {
  const filter = createBiquadBandpass(sampleRate);
  return values.map((value) => filter(value));
}

function scoreAxisCandidates(samples, candidates) {
  return candidates.map((candidate) => {
    const usable = samples.filter((sample) => sample.source === candidate.source && Number.isFinite(sample[candidate.axis]));
    if (usable.length < 20) return { ...candidate, power: 0, count: usable.length, sampleRate: 30 };
    const values = usable.map((sample) => sample[candidate.axis]);
    const sampleRate = estimateSampleRate(usable);
    const filtered = offlineBandpass(values, sampleRate);
    return { ...candidate, power: variance(filtered), count: usable.length, sampleRate };
  });
}

function bestCandidate(candidates) {
  return candidates.reduce((best, candidate) => (!best || candidate.power > best.power ? candidate : best), null);
}

export function pickRespirationAxis(samples) {
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

export function formatPowers(powers) {
  return Object.keys(powers).sort().map((axis) => `${axis}=${powers[axis].toFixed(5)}`).join(", ") || "none";
}

export function estimateCalibrationBpm(peaks) {
  if (peaks.length < 2) return NaN;
  const intervals = [];
  for (let i = 1; i < peaks.length; i += 1) intervals.push((peaks[i] - peaks[i - 1]) / 1000);
  return 60 / median(intervals.slice(-4));
}

export function createBreathDetector() {
  return {
    axis: null,
    filter: createBiquadBandpass(30),
    values: [],
    peaks: [],
    lastPeakMs: 0,
    currentBpm: null,
    lastBpm: null,
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
      if (!this.axis) return null;
      const y = this.filter(value);
      this.values.push({ t, y });
      this.values = this.values.slice(-180);
      if (this.values.length < 25) return null;
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
      if (!isPeak) return null;
      const intervalMs = this.lastPeakMs ? mid.t - this.lastPeakMs : null;
      if (intervalMs !== null && intervalMs < TIMING.refractoryMs) {
        this.rejectedPeakCount += 1;
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
          if (seconds >= 2.5 && seconds <= 15) intervals.push(seconds);
        }
        if (intervals.length) {
          this.currentBpm = clamp(60 / median(intervals), 4, 24);
          this.lastBpm = this.currentBpm;
        }
      }
      return mid;
    }
  };
}
