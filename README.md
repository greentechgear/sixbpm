# sixbpm

sixbpm is a paced breathing PWA that guides breathing toward 6 breaths per minute with audio tones, a visual orb, and optional motion sensing from a phone on the chest. It exists because Breathwrk has cratered after the Peloton acquisition and the FDA-cleared RESPeRATE device costs $320.

## Why 6 BPM

Breathing near 6 BPM often lands close to an individual resonance frequency, where heart-rate variability is amplified. HRV biofeedback literature describes this as a way to stimulate baroreflex function and increase vagal tone. See Lehrer and Gevirtz on HRV biofeedback mechanisms and resonance frequency breathing, and clinical RESPeRATE trials such as Schein et al. on device-guided slow breathing for blood pressure: https://doi.org/10.3389/fpsyg.2014.00756 and https://doi.org/10.1097/00004872-200104000-00017.

## How to use it

- Put your phone face-down on your chest.
- Lie down and get comfortable.
- Tap start session.
- Do not fight the pacer; if you cannot keep up, the app holds the target rate.
- Use 15 minutes daily for measurable BP effects per the literature.

## How to self-host

Drop these files on any static host.
HTTPS is required for iOS motion permission.
A sample `nginx.conf` block is included.

## Disclaimer

This is not a medical device, is not FDA-cleared, and should not be used to replace medication; if you have hypertension, work with your doctor.

## Build philosophy

Single HTML file, no framework, no build step, no analytics, no telemetry, no accounts. Open the source and read it. That's the whole point.
