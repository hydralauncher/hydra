# Achievement Notification Customizer: Implemented

This v1 adds a structured visual customizer for achievement custom notifications while preserving the existing achievement notification payload and IPC event shapes.

Implemented features:

- Desktop `Settings > Notifications` includes a gated button that opens the achievement notification customizer in its own window.
- The customizer window includes notification profiles backed by Hydra themes, with explicit profile selection, activation, delete, and autosave behavior.
- Customizer data is stored optionally on `Theme.achievementNotificationCustomizer`; legacy CSS-only themes and legacy `achievement.*` sounds remain valid.
- Variations resolve only from existing notification meaning:
  - Main: default payload.
  - Rare: `isRare`.
  - 100%: `isPlatinum`.
- `isHidden` does not affect variation, sound, routing, preset, or category selection; the existing hidden visual treatment remains layered on top.
- Live preview is local to settings and does not send OS or in-app notifications.
- Test live sends existing-shaped achievement notification payloads through the existing platform path and is available only when custom notifications are enabled.
- Windows external achievement notification rendering consumes structured CSS variables for colors, outline, radius, shadow, and default notification sizing.
- Linux and Big Picture continue using the existing focused-window in-app overlay path and consume the same structured renderer settings inside the app viewport.
- Per-variation sounds support default bundled audio or a chosen audio file. Legacy active-theme `achievement.*` sound fallback remains supported.
- Layout controls and linked-game profile routing are intentionally removed from the simplified customizer UI.

Architecture notes:

- `src/shared/achievement-notification-customizer.ts` owns defaults, variation resolution, enabled gating, CSS variable generation, and window size calculation.
- Existing `AchievementNotificationInfo` and notification IPC event payloads are unchanged.
- Legacy CSS-only themes remain valid, but the standalone customizer no longer exposes an advanced CSS editor.
