# sixbpm

sixbpm is a paced breathing PWA that guides breathing toward 6 breaths per minute with audio tones, a visual orb, and optional motion sensing from a phone on the chest. It also includes a fixed 4-7-8 humming mode for users who want a simple inhale-hold-hum pattern without adaptive breath detection. It exists because Breathwrk has cratered after the Peloton acquisition and the FDA-cleared RESPeRATE device costs $320.

## Why 6 BPM?

Six breaths per minute (0.1 Hz, a 10-second breath cycle) is the approximate **cardiovascular resonance frequency** of the human autonomic nervous system. Breathing at this rate phase-locks three oscillating systems: respiration, heart rate, and blood pressure. The result is maximum heart rate variability (HRV) and the strongest sustained vagal (parasympathetic) response your nervous system can generate without external input.

It's a mechanical resonance, not a wellness claim. Same principle as pushing a swing at its natural frequency: at resonance, small inputs produce large outputs.

### The mechanism

Three things in your cardiovascular system oscillate:

1. **Respiratory sinus arrhythmia (RSA)**: heart rate rises on inhale, falls on exhale. The oscillation frequency tracks your breathing rate.
2. **Baroreflex loop**: pressure sensors in the carotid arteries and aortic arch detect BP changes and feed back to the brainstem, which adjusts heart rate. The round-trip delay is about 5 seconds, giving the loop a natural resonance near **0.1 Hz (6 cycles/min)**.
3. **Mayer waves**: slow blood pressure oscillations, also around 0.1 Hz, driven by sympathetic vasomotor tone.

Breathe at about 6 BPM and you drive your respiratory oscillation at the same frequency as your baroreflex loop. They constructively interfere. HRV amplitude rises dramatically, baroreflex sensitivity increases, and the autonomic nervous system shifts toward parasympathetic dominance.

### Primary sources

**Foundational papers (resonance theory + protocol):**

- Lehrer, P. M., Vaschillo, E., & Vaschillo, B. (2000). Resonant frequency biofeedback training to increase cardiac variability: Rationale and manual for training. *Applied Psychophysiology and Biofeedback*, 25(3), 177-191. [pubmed.ncbi.nlm.nih.gov/10999236](https://pubmed.ncbi.nlm.nih.gov/10999236/)

- Lehrer, P. M., Vaschillo, E., Vaschillo, B., et al. (2003). Heart rate variability biofeedback increases baroreflex gain and peak expiratory flow. *Psychosomatic Medicine*, 65(5), 796-805. PMID: 14508023.

- Vaschillo, E. G., Vaschillo, B., & Lehrer, P. M. (2006). Characteristics of resonance in heart rate variability stimulated by biofeedback. *Applied Psychophysiology and Biofeedback*, 31(2), 129-142. [pubmed.ncbi.nlm.nih.gov/16838124](https://pubmed.ncbi.nlm.nih.gov/16838124/)

**Clinical training protocol:**

- Lehrer, P., Vaschillo, B., Zucker, T., et al. (2013). Protocol for Heart Rate Variability Biofeedback Training. *Biofeedback*, 41(3), 98-109. The standard five-session clinical protocol used in research and practice.

**Blood pressure outcomes (meta-analyses):**

- Chaddha, A., Modaff, D., Hooper-Lane, C., Feldstein, D. A. (2019). Device and non-device-guided slow breathing to reduce blood pressure: A systematic review and meta-analysis. *Complementary Therapies in Medicine*, 45, 179-184. 17 RCTs, mean systolic BP reduction **-5.62 mmHg [CI -7.86, -3.38]**, diastolic **-2.97 mmHg [CI -4.28, -1.66]**.

- Freitas Goncalves, K. S. de, et al. (2022). Device and nondevice-guided slow breathing to reduce blood pressure in hypertensive patients: A systematic review and meta-analysis. *Health Science Reports*. [PMID: 35601033](https://pubmed.ncbi.nlm.nih.gov/35601033/)

- Mahtani, K. R., Nunan, D., Heneghan, C. J. (2012). Device-guided breathing exercises in the control of human blood pressure: systematic review and meta-analysis. *Journal of Hypertension*, 30(5), 852-860. Earlier meta-analysis, 8 RESPeRATE RCTs.

### Important caveats

**6 BPM is an average, not a prescription.** Individual resonance frequencies range from about 4.5 to 7 BPM. Taller people tend lower (longer baroreflex loop). The Lehrer lab's clinical protocol determines each person's individual resonance frequency by measuring HRV amplitude while they breathe at 4.5, 5.0, 5.5, 6.0, 6.5, and 7.0 BPM. Whichever rate produces the highest peak is *their* resonance frequency. See: Shaffer, F., & Meehan, Z. M. (2020). *A Practical Guide to Resonance Frequency Assessment for Heart Rate Variability Biofeedback*. Frontiers in Neuroscience.

**Resonance frequency is not perfectly stable.** It can shift slightly between sessions, with posture, and over time. Some practitioners reassess periodically. See: Sevoz-Couche, C., & Laborde, S. (2022). Heart rate variability and slow-paced breathing: when coherence meets resonance. *Neuroscience & Biobehavioral Reviews*.

**Effect sizes on BP are modest.** About 5-6 mmHg systolic, about 3 mmHg diastolic, comparable to a low-dose antihypertensive. Clinically meaningful, not transformative. The American Heart Association gives device-guided slow breathing a **Class IIA, Level of Evidence B** recommendation as an adjunct for BP reduction. Some researchers have questioned whether the effect is reliably greater than active control breathing. See Landman et al. (2013), *JAMA Internal Medicine*, 173:1346, a sham-controlled trial that did not find significant benefit over control.

**Going slower than your resonance frequency is counterproductive.** Below your RF, you trigger air hunger and sympathetic activation. The protocol is "find your sustainable slow rate," not "breathe as slowly as possible."

**The 1:2 inhale:exhale ratio adds independent benefit.** Extended exhale activates the vagus nerve via pulmonary stretch receptors and diaphragmatic patterns, partially independent of resonance effects. So even if 6 BPM isn't exactly your RF, a 1:2 ratio at any slow rate is still vagally activating.

### Why sixbpm targets 6 (but lets you adjust)

The default floor of 6 BPM matches the population-average resonance frequency and the RESPeRATE clinical protocol. The floor slider lets you set anywhere from 5 to 10 BPM, so once you've used the app for a few sessions you can tune it to where *your* body is comfortable. If 8 BPM feels right and 6 feels like air hunger, set the floor to 8.

The honest target is **consistency at a rate below your natural baseline**. The specific number matters less than the practice.

A companion in-app reference, `vagal-tone.html`, explains vagal tone, sympathetic/parasympathetic balance, and the HRV metrics behind slow-paced breathing for readers who are new to the autonomic-nervous-system physiology.

## How to use it

- Put your phone face-down on your chest.
- Lie down and get comfortable.
- Tap start session.
- In 6 BPM mode, do not fight the pacer; if you cannot keep up, the app holds the target rate.
- Use 4-7-8 hum mode only if breath holds feel comfortable; stop if you feel lightheaded.
- Use 15 minutes daily for measurable BP effects per the literature.

## How to self-host

Drop these files on any static host.
HTTPS is required for iOS motion permission.
A sample `nginx.conf` block is included.

## Disclaimer

This is not a medical device, is not FDA-cleared, and should not be used to replace medication; if you have hypertension, work with your doctor.

## Build philosophy

Single HTML file, no framework, no build step, no analytics, no telemetry, no accounts. Open the source and read it. That's the whole point.


## Development

The app is still served as static browser ES modules with no build step. Run the pure-logic test suite with:

```bash
npm test
```

## License

MIT. See `LICENSE`.
