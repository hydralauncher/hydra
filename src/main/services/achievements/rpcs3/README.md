# Local RPCS3 trophies

This provider reads trophies for PS3 Classics games through Hydra's existing achievement models, game pages, library progress and notification presenter. It works without Hydra or RetroAchievements authentication.

## Discovery and state

- Use the existing PS3 emulator configuration and RPCS3 config/VFS resolver.
- Select RPCS3's explicit active local user, or the sole local user when no active user is configured. Ambiguous users are never combined.
- Map the game's selected/registered media to exact `NPWR` identifiers in `TROPDIR`, including folder installations and readable ISO images. Collections can contain several sets. Titles are never used for fuzzy matching.
- Read registered sets from `home/<user>/trophy/<NPWR>`. RPCS3 must register a set before it is available; the provider does not extract game TRP archives.
- Parse bounded `TROPCONF.SFM` definitions and the offset-based `TROPUSR.DAT` state table. Stable achievement names include both set and trophy IDs. Preserve earned states with unknown dates without fabricating timestamps. Definitions without state records appear locked.

## Updates

Startup establishes a silent baseline. Directory notifications, filtered to relevant names, detect trophy registration, state-file replacement and user changes. Debouncing and bounded retries accommodate partial writes; the last valid snapshot remains visible while a same-user read is incomplete. Switching users clears the old user's view before reading the new one.

Only previously known locked-to-earned transitions generate notifications. Repeated reads, duplicate watch events and application restarts do not replay an existing unlock. Library refreshes use the existing batch-complete event. There is no periodic polling loop.

## Score and scope

Local scores use trophy grades at a provisional multiplier of 25: bronze 375, silver 750, gold 2,250 and platinum 7,500. The UI identifies this as a local score, uses grade-based sorting labels and leaves global unlock percentages unavailable. Notifications distinguish an actual platinum trophy from merely completing a set.

Trophies are read-only. Generic achievement reset is unavailable for PS3 Classics, and clearing RetroAchievements progress preserves these entries. Local trophy unlocks never enter Steam/RetroAchievements upload queues. Hydra account points, leaderboards, account-to-account comparison and achievement souvenirs require separate backend/product support and are outside this provider.

## Verification

Tests use generated binary/XML fixtures and temporary directories rather than a user's trophy files. They cover state offsets, incomplete/corrupt data, retail SFM headers, timestamps, exact set discovery, active-user isolation, atomic replacement, bounded retries, library refreshes and notification deduplication. Reset and upload isolation are covered by the shared achievement sync tests.

Manual Windows validation used real registered trophy sets, an existing Ratchet: Deadlocked platinum, and new inFamous unlocks while RPCS3 and Hydra were open. The user confirmed Hydra's popup appeared alongside RPCS3's notification and earned progress survived reopening Hydra. The reviewed build also displayed library progress before opening individual game pages, including inFamous at 2/50; games without registered trophy files remained without a progress bar. Linux and macOS runtime behavior has not been manually verified.
