# sixbpm safety and acceptance spec

## Safety constraints

- The app must not include breath-hold presets or controls.
- Custom inhale:exhale ratio must stay between `1:1.0` and `1:2.0`. More extreme exhale ratios are rejected because they can create air hunger and make users fight the pacer.
- Floor BPM must stay between `5` and `10`; session duration must stay between `15` and `20` minutes.
- Baseline-derived starting targets must be clamped to avoid rapid cycles; the effective start target must not exceed `12 BPM`.
- A blocked or weak sensor stream must not stop the audio pacer. It may degrade to pacer-only mode and continue descending.

## Presets

- Balanced: 5s inhale, 5s exhale, 15 minutes.
- Calm: 3.3s inhale, 6.7s exhale, 15 minutes.
- Extended: Calm 1:2 timing for 20 minutes.
- Custom: selected when the user changes ratio, floor BPM, or duration manually.

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
- Presets produce the expected cycle timing and duration.
- Completion math does not count down below zero.
- Sync scoring is deterministic and bounded.
- Peak detection accepts slow synthetic breathing and rejects rapid/noisy candidates.
- Sensor fallback decisions distinguish enough events from blocked streams.
- Storage record writes preserve the expected fields.
