# Global leaderboards page in the launcher (LBX-1265)

SDD from 2026-10-21. Status: approved, scope = the full Claude Design screen.

Base: branch `feature/lbx-1265`, in the `hydra/hydra-launcher-lbx-1265` worktree, stacked on `feat/LBX-1266-game-page-leaderboard` (which sits on `feat/LBX-1267-leaderboard-top-position-styling`), because it reuses the per-game ranking row, medal and value formatter. Prototype: Claude Design "Rankings · em abas" (tabs **Ranking**, **By game** and **Your stats**). Backend: `hydra-api` on `feature/lbx-1259` (framework) and the endpoint introduced by LBX-1260 (`feature/lbx-1260`).

## Expected result

A **Leaderboards** page in the launcher, reached from the sidebar, that implements the Claude Design screen exactly, including what goes beyond the task text: the three tabs, badges, rank change, player totals, the review preview and the streak indicators. Where the API does not provide the data yet, the screen is ready with a local mock and the dependency is listed below.

## Task acceptance criteria

| Linear criterion                                                                                                                                                              | How this SDD meets it                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Sidebar/header entry to a Leaderboards page with tabs per metric (playtime, games, friends, achievements, souvenirs, reviews, review upvotes, sessions, streak, as available) | "Leaderboards" item with a trophy icon in `components/sidebar/routes.tsx`, title in `header.tsx` and the `/leaderboards` route in `main.tsx`. On the Ranking tab, the "Leaders of the week" cards are the metric tabs (`role="tab"`) and show each metric's current leader.                                                                                                                                                                                       | Met                          |
| Global/Friends toggle and This week/Last week toggle; a countdown to the weekly reset                                                                                         | Two `SegmentedControl`s in the header: Global/Friends and **Week/All time, as in the design** (decided; replaces Linear's "Last week" with "All time"). Subtitle "Week 43 · Oct 20–26 · Resets in 3d 14h", from `weekEnd` (fallback: next Monday 00:00 UTC), updated every 30 s. On All time the first place badge becomes "Record holder", the ▲▼ change disappears from rows and the subtitle explains the all-time board. Logged out users do not see Friends. | Met, with the decided change |
| Rows: rank, avatar (with frame if equipped), name (links to profile), value formatted per metric. The viewer's own row is pinned at the bottom when outside the top N         | Top 3 podium + `LeaderboardRow` from 4th place on (medal, avatar, name, bar, value, ▲▼ change). Clicking opens `/profile/:id`. `buildLeaderboardRows` pins the viewer's row with the "…" gap when they are outside the visible rows or the returned top. **Avatar frame: does not exist in the product yet (confirmed), out until it does.**                                                                                                                      | Met                          |
| Loading skeletons, empty board state, and error state (the API returns an empty board on timeout)                                                                             | Skeletons for the podium, rows, cards and every block of the other tabs. Empty state per window and scope (no friends, with "Find friends"). Error with "Try again". A timeout arrives as an empty board and falls into the empty state.                                                                                                                                                                                                                          | Met                          |
| Strings in `src/locales/en/translation.json`                                                                                                                                  | `leaderboards` namespace plus a `leaderboards` key in `sidebar` and `header`, in `en` and `pt-BR`.                                                                                                                                                                                                                                                                                                                                                                | Met                          |

## Screen scope (everything is in)

### Ranking tab

- "Leaders of the week" cards: one per metric, with icon, label, leader avatar, name and value, on a single row; the selected one has a light border.
- Metric board: icon + title + "Top 13 of 12,480 players"; podium (heights 288/260/240, gold/silver/bronze metal band with shine, profile banner, avatar 64/52, "Leader of the week" badge on 1st, ▲▼ change on 2nd and 3rd, regular weight values); rows 4–13 with optional banner, cyan to violet bar relative to 1st and ▲▼ change; the viewer's row highlighted with the "You" tag and a full strength bar; "Show more".
- Reviews: "Most upvoted review" card above the podium (cover, game, avatar, blue star score, capitalized relative date, two line text, cyan like icon with votes, "View on the {game} page" on its own line); clicking a podium card switches the review; hovering a row shows the review tooltip.
- Streak: cyan to violet flame for an active streak, grey value for an ended streak.
- "Your badges": "5 of 14 earned", cards with cover, chip (TOP 1%, rank, days), title, subtitle, date or a cyan to violet progress bar ("4 h to go"), animated ring per tier; the streak badge uses the cyan to violet border and chip; "Show more".

### By game tab

- "Your games' rankings" with search: one card per game on a single row (cover, your rank "#6 of 12,480", change, leader).
- Selected game: hero with the game art, "{game} ranking", "{N} players · You are #6", "Open game page", metric chips, podium and rows as on the Ranking tab and "Show more" (no "View full ranking": the tab already is the full ranking, decided).

- Deep link from the game page (LBX-1266): `/leaderboards?tab=games&shop=&objectId=` opens this tab with that game selected; a game outside "Your games" still opens, with title and art from `getGameAssets`.

### Your stats tab

- "Your week": banner + avatar, and one row per metric with ▲▼ change next to your rank.
- "Daily streak": current and record, a 15 week heatmap (levels with increasing brightness from dim cyan to glowing violet, 0 h to 3 h+), day tooltip with hours and games; same height as "Your week".
- "Streaks among friends": list with presence and days, empty state "No friends to compare with" with "Find friends", "See all friends".
- "Your badges" (same block as on the Ranking tab).

## API dependencies

| Screen data                                                                     | Source                       | Status                                                                              |
| ------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| Global playtime/games/friends/achievements/souvenirs boards, `window=week\|all` | `GET /leaderboards/:metric`  | LBX-1260                                                                            |
| Sessions and streak boards                                                      | LBX-1262, LBX-1263           | SDD ready, no code                                                                  |
| Reviews board + the leader's review (game, score, text, votes)                  | no task                      | **needs a backend task**                                                            |
| `backgroundImageUrl` on the user                                                | framework                    | decided in LBX-1260                                                                 |
| Total eligible players per board                                                | no field                     | **needs to be added to the framework** (`total` in the response)                    |
| ▲▼ change (rank in the previous week)                                           | no field                     | **needs to be added to the framework** (`previousRank` per entry and on the viewer) |
| Active/ended streak per entry                                                   | LBX-1263                     | to confirm in the contract                                                          |
| "Your games" list with your rank, total and leader                              | no endpoint                  | **needs an endpoint** (on top of the LBX-1264 per-game boards)                      |
| Per-game board with metrics                                                     | LBX-1264                     | SDD ready                                                                           |
| 15 week daily heatmap and streak record                                         | LBX-1262/LBX-1263            | to confirm in the contract                                                          |
| Friends' streaks with presence                                                  | LBX-1263 + existing presence | to confirm                                                                          |
| Badges (earned, progress)                                                       | no task                      | **needs a backend task**                                                            |

Until each dependency exists, its block uses the local mock; switching to the real API happens per block.

## Proposed contracts (the mock already answers like this)

| Endpoint                                                           | Response                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /leaderboards/:metric?window=week\|all&scope&take`            | framework response + `total` (eligible players), `previousRank` per entry and on `viewer`, `streakActive` (streak only) and `review` `{ gameTitle, shop, objectId, coverImageUrl, score, createdAt, text }` (reviews only)                                                                                   |
| `GET /leaderboards/me/games?window&scope`                          | `{ games: [{ shop, objectId, title, coverImageUrl, heroImageUrl, rank, previousRank, total, leader }] }`                                                                                                                                                                                                     |
| `GET /games/:shop/:objectId/leaderboards/:metric?range&scope&take` | LBX-1264 route + `previousRank` per entry                                                                                                                                                                                                                                                                    |
| `GET /users/me/play-activity?weeks=15`                             | `{ currentStreak, bestStreak, playedToday, days: [{ date, seconds, games }] }`                                                                                                                                                                                                                               |
| `GET /users/me/friends/streaks`                                    | `{ friends: [{ user, days, bestDays, active, online }] }` (includes the viewer)                                                                                                                                                                                                                              |
| `GET /users/me/leaderboard-badges`                                 | `{ earned, total, badges: [{ id, kind, tier, metric, scope, gameTitle, coverImageUrl, value, week, currentRank, earnedAt, progress }] }`; `kind` = `top_percent\|weekly_leader\|top_rank\|friends_podium\|streak_record`, `tier` = `gold\|silver\|bronze\|streak`. Texts are built in the launcher with i18n |

## Decisions

1. **Scope = the design screen**, including what is not in the task text (decided).
2. **Avatar frame** stays out because it does not exist in the product yet (decided).
3. **Tabs = leader cards** on the Ranking tab. The page fetches every metric's board when it opens (in parallel, with the renderer cache and request dedupe, plus the backend Redis cache).
4. **Displayed metrics** are the 7 from the design, in this order: Playtime, Games, Friends, Achievements, Souvenirs, Streak and Reviews (the Reviews value is the sum of upvotes received on reviews, which covers Linear's "review upvotes"). Sessions and review count are not cards because they are not in the design; Sessions remains a chip on the By game tab, as in the design.
5. **Shared code**: the page imports from `pages/game-details/leaderboard/` (types, `buildLeaderboardRows`, `LeaderboardRow`, `SegmentedControl`, styles). Moving them to `components/leaderboard/` is a refactor after LBX-1266 merges.
6. **Pagination**: the API returns up to 100 entries; the screen shows 13 and "Show more" adds 10 without a new request.
7. **Order and eligibility** come from the backend (profile photo required on global, subscriber tie-break; LBX-1259 addendum A). The launcher does not reorder.
8. **Period = Week / All time**, as in the design. The launcher sends `window=week|all`.
9. **Gamification colour**: the cyan to violet gradient (`#22c7ee` → `#b05cff`) marks progress and streaks: flames, heatmap, streak badge, badge progress bars, ranking bars, and the like and star icons on reviews. Medals, ▲▼ colours and the leader trophy keep their own colours.
10. **`GLOBAL_LEADERBOARDS` feature flag** (decided after review): while it is off, the sidebar item and the game page "View full ranking" link are hidden and `/leaderboards` redirects home without fetching. The API turns it on once the endpoints listed above ship.

## Performance and backend behaviour

- One renderer response cache (`createResponseCache`, 60 s, deduping identical in-flight requests). Switching to an already visited tab, period or scope does not refetch nor flash a skeleton, because the screen reads the cache synchronously.
- The countdown lives in `WeekSubtitle`; its 30 s tick does not re-render the page.
- When the week resets with the page open, the cache is cleared and every block reloads.
- A metric whose board fails (for example the backend does not serve Streak or Reviews yet) disappears from the cards and from "Your week"; if all fail, all stay visible and the board shows the error. API errors reach the renderer only as a message, without the HTTP status, so a 404 cannot be told apart from a network failure.
- Animations: the podium shine uses only `transform` (GPU). The badge ring animates a `conic-gradient` angle, which repaints every frame, but only on a few small elements.

## Before the PR

- `leaderboards-api.ts` calls `globalThis.window.electron.hydraApi.get` and returns `null` for the viewer when logged out; the local mock only replaces those lines in the working tree.
- Do not commit `*-mock.local.ts`, `src/renderer/public/leaderboard-mock.local/` or the LBX-1266 `// LOCAL MOCK` lines.
- PR stacked on LBX-1266 (and that one on LBX-1267) with `gh stack`.

## States

| State         | When                                   | What shows                                                                        |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| loading       | first load of a block                  | block skeleton                                                                    |
| ready         | there is data                          | content                                                                           |
| empty         | empty list (includes timeout)          | icon + text for the window                                                        |
| empty_friends | Friends with nobody besides the viewer | text + "Find friends"                                                             |
| error         | network/parse failure                  | message + "Try again"                                                             |
| logged out    | no session                             | Global only, no pinned row, no By game, Your stats or badges, with a sign-in hint |

## Changes per file

| File                                                                        | Change                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pages/leaderboards/leaderboards.tsx`                                       | page, header, toggles, page tabs                                                                    |
| `pages/leaderboards/week-subtitle.tsx`                                      | week label, countdown and week reset                                                                |
| `pages/leaderboards/ranking-tab.tsx`                                        | leader cards, board, selected review                                                                |
| `pages/leaderboards/by-game-tab.tsx`                                        | games list, hero, per-game board                                                                    |
| `pages/leaderboards/stats-tab.tsx`                                          | your week, daily streak + heatmap, streaks among friends                                            |
| `pages/leaderboards/board-view.tsx`                                         | podium + rows + show more shared by the tabs                                                        |
| `pages/leaderboards/leaderboard-podium.tsx`                                 | top 3 podium                                                                                        |
| `pages/leaderboards/leaderboard-bits.tsx`                                   | rank change, streak flame, block states                                                             |
| `pages/leaderboards/badges-section.tsx`                                     | your badges                                                                                         |
| `pages/leaderboards/metric-icon.tsx`                                        | metric icons                                                                                        |
| `pages/leaderboards/global-leaderboard.ts` (+ `.test.ts`)                   | metrics, request, normalizers, response cache, states, ISO week, countdown, change, heatmap, badges |
| `pages/leaderboards/leaderboards-api.ts`                                    | API access, viewer, cached resource hook                                                            |
| `pages/leaderboards/use-global-leaderboards.ts`                             | global boards for every metric                                                                      |
| `pages/leaderboards/use-global-leaderboard-value.ts`                        | value formatting per metric                                                                         |
| `pages/leaderboards/leaderboards.scss`                                      | BEM styles                                                                                          |
| `pages/game-details/leaderboard/leaderboard-controls.tsx`                   | exports `SegmentedControl`                                                                          |
| `pages/game-details/leaderboard/leaderboard-row.tsx`, `leaderboard.scss`    | optional rank addon, value prefix, muted value and tooltip slots                                    |
| `main.tsx`, `components/sidebar/routes.tsx`, `components/header/header.tsx` | route, sidebar item with the design trophy icon, title                                              |
| `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json`     | strings                                                                                             |
| `pages/leaderboards/leaderboards-mock.local.ts`                             | local mock, **not committed**                                                                       |

## Tests and acceptance

- `global-leaderboard.test.ts` (`node:test`, same pattern as `game-leaderboard.test.ts`): request, normalizers, response cache (key, TTL, dedupe, uncached errors, clear), available metrics, states, rank change, viewer ranking, ISO week, countdown, heatmap and badge progress. 54 tests pass together with the LBX-1266 and rank tier tests.
- Goal: 80% or more of the new logic lines. Components are validated in the launcher.
- Manual test in the launcher with the mock (`localStorage.globalLeaderboardMock` = `full`, `empty`, `empty_friends`, `error`, `slow`, `leader`): the three tabs, toggles, countdown, podium, review, streak, badges, "Show more", pinned row, profile link, logged out.
- Once the backend ships: validate each block against a local `hydra-api`.
