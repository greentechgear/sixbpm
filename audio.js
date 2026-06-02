const TONE_OUTPUT_GAIN = 0.5;

export function createAudioController(log = () => {}) {
  const audio = {
    ctx: null,
    masterGain: null,
    noSleep: null,
    wakeLock: null,
    async ensure() {
      if (!window.AudioContext && !window.webkitAudioContext) {
        throw new Error("Web Audio is not supported.");
      }
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = TONE_OUTPUT_GAIN;
        this.masterGain.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this;
    },
    scheduleTone(startAt, duration, startFreq, endFreq) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(startFreq, startAt);
      osc.frequency.linearRampToValueAtTime(endFreq, startAt + duration);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(1, startAt + duration * 0.22);
      gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    },
    async requestWakeLock(diagnostics) {
      try {
        if ("wakeLock" in navigator) {
          this.wakeLock = await navigator.wakeLock.request("screen");
          diagnostics.wake_lock = "active";
          return;
        }
        diagnostics.wake_lock = "fallback audio";
        this.startNoSleepFallback();
      } catch (error) {
        diagnostics.wake_lock = `failed: ${error.message}; fallback audio`;
        log(`Wake lock failed: ${error.message}`);
        this.startNoSleepFallback();
      }
    },
    startNoSleepFallback() {
      if (!this.ctx || this.noSleep) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0.00001;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.noSleep = { osc, gain };
    },
    async releaseWakeLock() {
      try {
        if (this.wakeLock) await this.wakeLock.release();
      } catch (error) {
        log(`Wake lock release failed: ${error.message}`);
      }
      this.wakeLock = null;
      if (this.noSleep) {
        try {
          this.noSleep.osc.stop();
          this.noSleep.osc.disconnect();
          this.noSleep.gain.disconnect();
        } catch (error) {
          log(`No-sleep fallback release failed: ${error.message}`);
        }
        this.noSleep = null;
      }
    }
  };
  return audio;
}
