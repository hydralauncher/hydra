# Game page leaderboard (LBX-1266)

SDD written on October 21, 2026, revised on October 22, 2026. Status: implemented. The PR waits for LBX-1265, which owns the route that "View full ranking" opens.

Base: branch `feat/LBX-1266-game-page-leaderboard`, stacked on `feat/LBX-1267-leaderboard-top-position-styling` because it uses `RankMedal` and `RankFrameRing`. Visual references: the "Game Ranking Card" prototype (boards "Game page sidebar · Ranking", "Ranking states" and "View all · Full board") and the launcher Design System. Backend read at `hydra-backend/backend@70250f4c`.

## Expected result

The game page sidebar gets a "Ranking" section right below Achievements. It shows the top 5 players by playtime with This week and All time, your own row highlighted, and how far you are from the player right above you. "View full ranking" opens the "By game" tab of the leaderboards page (LBX-1265) with the current game selected.

Global and Playtime already work with real data. The Friends scope and the Sessions, Souvenirs and Streak metrics are built but stay behind a feature flag until LBX-1264 ships the API.

## Task acceptance criteria

| Linear criterion                                                                                                                             | How it is met                                                                                                                                                          | Status                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Game page section with the top N for the selected metric (playtime by default; sessions, souvenirs, streak as available), This week/All time | "Ranking" section with the top 5, This week and All time, and Playtime by default. The other metrics stay behind the flag until the API exists.                        | Met with the current API. The other metrics depend on LBX-1264. |
| Friends tab: friends who own the game plus you, always showing your own rank                                                                 | Built in the launcher, behind the flag.                                                                                                                                | **Waiting on LBX-1264:** the API has no friends scope.          |
| Your row is highlighted; "View all" opens the full board                                                                                     | Your row is highlighted with a "You" tag. "View full ranking" opens the leaderboards page (LBX-1265) on the "By game" tab with the current game (October 21 revision). | Met once LBX-1265 lands, since it owns the route.               |
| Hidden for custom games and when logged out (Global still visible if the API allows anonymous access)                                        | Hidden for custom games. The API is public, so signed-out users see Global only, with a sign-in prompt.                                                                | Met                                                             |
| Strings in `src/locales/en/translation.json`                                                                                                 | English is required; `pt-BR` is included too.                                                                                                                          | Met                                                             |

The task can move to Done only after LBX-1264 ships and the flag is turned on. Until then, this change delivers the Global board.

Prototype items that are not in the criteria (the "X to pass" hint, the empty states and the error state) are included because they are designed.

## What the API offers today

`GET /games/:shop/:objectId/top-users` (`games.controller.ts:406`, `game-top-users.service.ts:271`):

- is public, with no auth guard;
- accepts `take` from 1 to 100 (default 10) and `range` `week` or `all` (default `all`);
- only works for catalogue shops: `steam`, `epic` and `launchbox`;
- responds with `{ users: [{ rank, playTimeInSeconds, user: { id, displayName, profileImageUrl } }], periodStart?, periodEnd? }`, with the period only for `week`;
- responds with an empty list on timeout or when an Epic game is not published.

It has no friends scope, no other metrics, no viewer rank outside the top, no total player count and no profile banner.

## Decisions

| Topic                      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placement                  | A "Ranking" `SidebarSection` in `sidebar.tsx`, after Achievements. Requests use `catalogueGame`, never `shop`, which can be the achievement shop.                                                                                                                                                                                                                                                                                                                                                                      |
| When hidden                | `custom` games, shops other than `steam`/`epic`/`launchbox`, or no `objectId`.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Request                    | One per game, period, scope and metric combination, always with `take=100`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cache                      | In-memory at module level, with a 60 s TTL and in-flight request deduplication, following the ProtonDB pattern in `sidebar.tsx:42`.                                                                                                                                                                                                                                                                                                                                                                                    |
| Stale data                 | The loaded board is stored with the game, period, scope and metric it was fetched for (`selectLoadedLeaderboard`). A board from another game is never shown, and values and empty states always use the query the data belongs to.                                                                                                                                                                                                                                                                                     |
| Auth                       | `needsAuth` only when a user is signed in, so the API can compute the viewer's rank. Signed-out requests are public.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Your row                   | Found by comparing `user.id` with `userDetails.id`, or through the API's `viewer`. On the card it is always pinned at the bottom, after an ellipsis, even when you are in the top 5 (October 21 revision). It is not duplicated on an empty friends board. Without a rank, nothing is shown.                                                                                                                                                                                                                           |
| "X to pass" hint           | The gap to the player one rank above, when both are in the response. At rank 1 it shows "You lead this ranking". Without enough data the line is hidden. A positive gap is never shown as 0 minutes.                                                                                                                                                                                                                                                                                                                   |
| Controls                   | October 21 revision: Global/Friends and This week/All time are dropdown filters (Radix, following the Library filters), side by side, sized to their content and left-aligned with the list. The 4 metrics use the sliding switch.                                                                                                                                                                                                                                                                                     |
| Feature flag               | `Feature.GameLeaderboardsExtended = "GAME_LEADERBOARDS_EXTENDED"` in `use-feature.ts`, turned on through the backend's `/features`. When off, the Friends filter and the metric switch are hidden and `scope`/`metric` are never sent.                                                                                                                                                                                                                                                                                 |
| Expected LBX-1264 contract | With the flag on, the launcher sends `metric=playtime\|sessions\|souvenirs\|streak` and `scope=global\|friends` to the same endpoint. It reads `value` or `playTimeInSeconds`, an optional `viewer` `{ rank, value }` and an optional `user.backgroundImageUrl`. Invalid entries are dropped. This needs to be confirmed with whoever builds LBX-1264.                                                                                                                                                                 |
| Values                     | Playtime shows hours, or minutes under 2 hours. Sessions and Souvenirs are plain numbers. Streak is "N days".                                                                                                                                                                                                                                                                                                                                                                                                          |
| Profile banner             | October 21 prototype revision. When a row's user has `user.backgroundImageUrl`, the row uses it as the background with the prototype's dark gradient (94% → 72% → 40%). Without it, the row is plain. The API does not send the field yet; it belongs in the LBX-1264 contract. No cloud icon.                                                                                                                                                                                                                         |
| "You" tag on a banner      | `rgba(13,13,13,0.55)` background with `backdrop-filter: blur(10px)` and `$muted-color` text, so it stays readable on the image. Banner rows always keep light text and a stronger progress track.                                                                                                                                                                                                                                                                                                                      |
| Top three                  | Rows 1 to 3 get the `rank-frame` classes and render `RankFrameRing` from LBX-1267, with or without a banner.                                                                                                                                                                                                                                                                                                                                                                                                           |
| View full ranking          | Navigates to `/leaderboards?tab=games&shop=<shop>&objectId=<objectId>` (`buildGameLeaderboardPath`). LBX-1265 reads these parameters and opens the "By game" tab with the game selected. The button only shows when the `GLOBAL_LEADERBOARDS` flag is on (`Feature.GlobalLeaderboards`, the same flag LBX-1265 uses for the page), so this change never links to a missing route. The prototype's modal was dropped in the October 21 revision. With the flag, this PR can land before LBX-1265 without a broken link. |
| Icons                      | Octicons (`GlobeIcon`, `PeopleIcon`, `CalendarIcon`, `GraphIcon`, `ArrowRightIcon`) instead of the prototype's SVGs, as the Design System asks.                                                                                                                                                                                                                                                                                                                                                                        |
| Strings                    | `leaderboard` namespace, sentence case and no emoji, in `en` and `pt-BR`.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## States

| State          | When                                      | What it shows                                                                                                                                                                                 |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading        | First response pending                    | 4-row skeleton (`react-loading-skeleton`, same theme as HowLongToBeat).                                                                                                                       |
| Ready          | There are rows                            | Controls, rows, the "X to pass" hint and "View full ranking".                                                                                                                                 |
| Empty week     | `week` with no rows                       | "No one played this week", "Be the first to score before Sunday" and a "View all-time ranking" button.                                                                                        |
| Empty all time | `all` with no rows                        | "No one has played this yet".                                                                                                                                                                 |
| Empty friends  | `friends` with only you (behind the flag) | "None of your friends have this game", your row and a "Find friends" button that opens the friends window.                                                                                    |
| Signed out     | No `userDetails`                          | Global only and the prompt "Sign in to see your position and your friends' ranking", with a "Sign in" button (`openAuthWindow(AuthPage.SignIn)`) styled as in the "Ranking states" reference. |
| Error          | The request failed                        | "Couldn't load the ranking" and a "Try again" button.                                                                                                                                         |

## Visual behavior

- The metric switch indicator slides with the prototype's curve, `cubic-bezier(0.34, 1.4, 0.64, 1)` over 0.46 s.
- Rows are 56 px tall, with a 36 px avatar (`Avatar`), the name, the "You" tag and a 3 px bar relative to the leader.
- Progress tracks, fills and the ellipsis follow the row text color, so they stay visible on light themes.
- Your row has a `rgba(255,255,255,0.08)` background when it has no banner.
- Clicking any row opens that player's profile.
- With `prefers-reduced-motion`, transitions are turned off.

## Out of scope

- The weekly reset countdown and the global page, which belong to LBX-1265.

## Changes by file

| File                                                                    | Change                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/pages/game-details/leaderboard/game-leaderboard.ts`   | Types, normalization, rows, "X to pass" hint, state, loaded-board selection, page path and cached fetching. No React, fully testable. |
| `.../leaderboard/use-game-leaderboard.ts`                               | Hook with stale-response protection, following `use-similar-games.ts`.                                                                |
| `.../leaderboard/use-leaderboard-value.ts`                              | Value formatting per metric.                                                                                                          |
| `.../leaderboard/leaderboard-section.tsx`                               | Sidebar card.                                                                                                                         |
| `.../leaderboard/leaderboard-row.tsx`                                   | Card row, also used by the LBX-1265 page.                                                                                             |
| `.../leaderboard/leaderboard-controls.tsx`                              | Dropdown filters and the metric switch.                                                                                               |
| `.../leaderboard/leaderboard.scss`                                      | Styles.                                                                                                                               |
| `.../sidebar/sidebar.tsx`                                               | Adds the section.                                                                                                                     |
| `src/renderer/src/hooks/use-feature.ts`                                 | New flag.                                                                                                                             |
| `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json` | Keys in the `leaderboard` namespace.                                                                                                  |

## Tests

Automated (`node:test`, in `game-leaderboard.test.ts`):

- **Normalization:** accepts `playTimeInSeconds` and `value`; drops entries without `rank` or `user.id` or with invalid values; sorts by `rank`; reads `viewer` and the banner when present.
- **Rows:** top N; the viewer inside the top without duplication by default; the viewer outside the top after an ellipsis; the pinned viewer row; the bar relative to the leader with a 4% minimum.
- **"X to pass" hint:** above you, at rank 1, and without the player above in the response.
- **State:** loading, ready, empty week, empty all time, empty friends and error.
- **Loaded board:** the board stays tied to its game and query, and a board from another game is ignored.
- **Fetching:** parameters with the flag on and off, cache use within the TTL, in-flight deduplication, and no API call for unsupported games.
- **Page path:** the "By game" URL with encoded ids.

Coverage target is at least 80% of `game-leaderboard.ts`. The visual components are checked in the app.

Manual checks with `yarn dev`:

- Matches the prototype for This week and All time, using local mock data (not committed).
- Signed in and signed out.
- On a custom game, the section is hidden.
- With `GAME_LEADERBOARDS_EXTENDED` turned on, the Friends filter and the metric switch appear.
- Light and dark themes stay readable.
- "View full ranking" opens the "By game" tab of the leaderboards page with the current game (depends on LBX-1265).
- `yarn typecheck`, `yarn lint` and `yarn test` pass.
