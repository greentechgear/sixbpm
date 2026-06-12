# sixbpm safety and acceptance spec

## Safety constraints

- The app must not include arbitrary breath-hold controls. The only breath-hold pattern is the named 4-7-8 hum mode, fixed at 4s inhale, 7s hold, and 8s humming exhale.
- Custom inhale:exhale ratio must stay between `1:1.0` and `1:2.0`. More extreme exhale ratios are rejected because they can create air hunger and make users fight the pacer.
- Floor BPM must stay between `5` and `10`; session duration must stay between `15` and `20` minutes.
- Baseline-derived starting targets must be clamped to avoid rapid cycles; the effective start target must not exceed `12 BPM`.
- A blocked or weak sensor stream must not stop the audio pacer. It may degrade to pacer-only mode and continue descending.

## Presets

- 6 BPM: adaptive 1:2 pacing toward the selected floor, defaulting to 6 BPM for 15 minutes.
- 4-7-8 hum: fixed 19-second cycle with inhale, hold, and humming exhale phases; sensor detection is not used for this mode.
- Custom: selected when the user changes ratio, floor BPM, or duration manually for adaptive pacing.

## Browser and platform behavior

- iOS Safari must request motion permission from the Start button path.
- Chrome should use DeviceMotion, DeviceOrientation, and Generic Sensor where available.
- Brave or blocked motion sensors should show a clear sensor-blocked message and continue in pacer-only mode.
- Hidden-tab behavior pauses the session clock and resumes when visible again.
- Wake Lock should be requested when sessions start; silent audio fallback is acceptable when unsupported.

## PWA and degraded environments

- Service worker must precache HTML, CSS, JS modules, manifest, icon assets, and informational pages.
- Offline reload should serve the cached app shell.
- Clipboard failures must reveal the diagnostic report in a selectable textarea.
- localStorage write failures must be logged, not thrown uncaught.

## Acceptance tests

- Reject ratio values above `2.0` and below `1.0`.
- Presets produce the expected adaptive cycle timing and fixed 4-7-8 hum timing.
- Completion math does not count down below zero.
- Sync scoring is deterministic and bounded.
- Peak detection accepts slow synthetic breathing and rejects rapid/noisy candidates in adaptive mode.
- Sensor fallback decisions distinguish enough events from blocked streams.
- Storage record writes preserve the expected fields.
