# Rankings: fixes from the production review of October 29

SDD written on October 29, 2026. Status: awaiting Eduardo's approval. No Linear task yet.

Base: launcher `dcb5bcfaf` (`origin/main`), branch `fix/leaderboards-prod-review`, worktree `hydra-launcher-lb-prod-review`. Backend `19d3ba53` (`origin/main`): no code change, only operations (see "API side").

## What was seen on production (launcher 4.3.0, main build)

| #   | Screen                                  | Seen                                                                                                          | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Side                                          |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1   | Your badges                             | "Top 765120% in EA SPORTS FC 24" and "33 h to go for Top 765120%"                                             | The API sends `threshold` (10, 5, 1 or the Top N rank) and `value` (the viewer's value on the board, here 765,120 s). `normalizeBadges` reads `value` as the N of the badge, and `normalizeBadgeTarget` falls back to the locked badge's `value` for the target. The launcher unit tests encoded that wrong contract.                                                                                                                                              | Launcher                                      |
| 2   | Game page leaderboard card              | Only "Playtime", no Sessions/Souvenirs/Streak chips, no Global/Friends                                        | The chips and the scope toggle need the `GAME_LEADERBOARDS_EXTENDED` feature flag, which does not exist on production (only `GLOBAL_LEADERBOARDS` was created today).                                                                                                                                                                                                                                                                                              | API operations                                |
| 3   | Your stats, "Your history", all time    | "–" on every metric but Achievements, which shows 7 unlocked and 4005th                                       | The all-time global boards read `UserStatsTotals` (`trackedPlayTimeInSeconds`, `gamesPlayed`, `achievementsUnlocked`), `UserActivityTotals` and `UserSessionTotals`. Since October 23 a trigger adds deltas to `UserStatsTotals`, but the starting values come only from `backfill-leaderboard-activity`, which has not run on production: 7 achievements is the delta since the trigger, not the total, and 8.7 h of FC 24 playtime gives no playtime row at all. | API operations                                |
| 4   | Your stats, "Streak among friends"      | "No friends to compare with / Add friends" with 3 friends                                                     | `GET /users/me/friends/streaks` returns only friends with a live streak (documented). None of the three has one, so the list is empty and the copy, written for "no friends", misleads.                                                                                                                                                                                                                                                                            | Launcher (copy)                               |
| 5   | Rankings header                         | Content jumps up when switching Week to All time                                                              | The subtitle under "Rankings" has two lines for a week (dates + "Resets in") and one line for all time.                                                                                                                                                                                                                                                                                                                                                            | Launcher                                      |
| 6   | Ranking, Friends metric                 | Leaders with 12, 8 and 7 friends; a viewer with 3 friends is not on the board                                 | Same as 3: `UserActivityTotals.friendsCount` only counts friendships accepted after the deploy until the backfill runs.                                                                                                                                                                                                                                                                                                                                            | API operations                                |
| 7   | Game board, Streak                      | Longest streak is 2 days                                                                                      | `UserPlayStreak`/`GamePlayStreak` were created on October 24 and shipped on October 26; nobody can have more days than that. Not a bug.                                                                                                                                                                                                                                                                                                                            | None                                          |
| 8   | Ranking, Reviews metric                 | The review preview flashes at the top left of the list when the pointer leaves a row or moves to the next one | `LeaderboardRow.stopFollowing` removes the inline `left`/`top` synchronously and only then asks React to drop the `--pointer` class. Until that render commits, the tooltip is still `position: fixed; display: block` with no offsets, so it paints for one frame at the fixed layer's origin (the red square).                                                                                                                                                   | Launcher                                      |
| 9   | By game, "Rankings of your games" cards | "1st of 1" on Toribash with a full board; most cards read "Nth of N"                                          | `GET /leaderboards/me/games` sends `total: null` when the board's position marker is not saved yet (documented: a lower bound, null until then). `normalizeMyGames` fills a null `total` with the viewer's `rank`, so every such card reads "Nth of N". The board header already handles the null ("You are 1st").                                                                                                                                                 | Launcher                                      |
| 10  | Ranking, Reviews metric                 | The leader's review shows in Russian, untranslated                                                            | `GET /leaderboards/reviews` sends each highlight without `translations` and `detectedLanguage` (`review-highlights.ts` selects neither column). The launcher already applies the game page rule when they come.                                                                                                                                                                                                                                                    | API code (session "hydra-api", second branch) |

Accepted as designed earlier today: the "All time" board is slow on a cold Redis cache (6 h expiry, 2 s wait), and the "x h to climb" hint on the game card only shows when the player above is in the loaded top 100.

## Expected result

1. A badge reads "Top 10% in EA SPORTS FC 24" / "TOP 10%", and a locked badge reads "33 h to go for Top 5%" (or "Top 10"), with the N taken from the API's `threshold`.
2. Switching Week and All time keeps the toggles, tabs and content at the same vertical position.
3. With friends but none on a streak, the friends streak card says that no friend has an active streak and still offers "Find friends".
4. The review preview on the Reviews ranking follows the pointer, and disappears or moves to the next row without flashing anywhere else.
5. A game card shows "1st" alone when the API does not know the board size, and "4th of 239" when it does.
6. On the API side, after the two operations below, "Your history" shows the viewer's all-time rank and value on every metric they qualify for, and the game card shows the metric chips and the Global/Friends toggle.

## Decisions

| Topic               | Decision                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Badge N             | `normalizeBadges` sets `value` from `item.threshold` for `top_rank` and `top_percent`. Other kinds (`weekly_leader`, `friends_podium`, `streak_record`) keep `item.value`, which the API fills with the count they show (week number, days). `value` is left as the field name so `badges-section.tsx` and the chip/title strings do not change. |
| Badge target        | `normalizeBadgeTarget` keeps reading `item.target` when present. The fallback for a locked `top_rank`/`top_percent` badge is now `{ kind: item.kind, value: item.threshold }`, never `item.value`. A locked badge without `threshold` has no target and falls back to the plain "x to go" text, as today.                                        |
| Old API             | A `top_*` badge without `threshold` keeps `value: 0`, so a title would read "Top 0". Production already sends `threshold` (the schema in `leaderboard-viewer.controller.ts` requires it), so no compatibility path is kept.                                                                                                                      |
| Header height       | `WeekSubtitle` renders the same two lines for all time as for a week: the subtitle plus an empty, `aria-hidden` countdown line. Same classes, so the height matches exactly without guessing line heights in CSS.                                                                                                                                |
| Board size cap      | Eduardo (October 29): a big board must not print a huge number next to the rank. `formatBoardTotal` shows "10,000+" (locale formatted) from `BOARD_TOTAL_CAP = 10_000` up, on the game cards, the selected game's header and the ranking's "Top N of M players". The API keeps sending the real number.                                          |
| Friends streak copy | New keys `empty_friend_streaks_title` ("No friend on a streak") and the existing `empty_friend_streaks_description` reworded ("Friends who play two days in a row show up here.") in `en`, `pt-BR`, `es` and `ru`. `empty_friends_title` stays for the other callers.                                                                            |
| Tooltip flicker     | `stopFollowing` only clears the React state. The inline `left`/`top` are removed in an effect that runs once `tooltipSide` is `null`, after the commit that set `display: none` back. `followPointer` keeps writing the position before enabling the pointer class, so showing never flashes either. Scroll and wheel use the same path.         |
| Game card total     | `MyGameRanking.total` becomes `number \| null`; `normalizeMyGames` keeps `null` (and drops a total below the rank, as the API promises). `by-game-tab.tsx` renders "of N" only when `total` is a number; the selected-game fallback already accepts `null`.                                                                                      |
| Tests               | `global-leaderboard.test.ts`: `normalizeMyGames` keeps a null total; the badge cases send `threshold` and the viewer's `value` side by side and assert the N and the target come from `threshold`.                                                                                                                                               |

## Out of scope

- Showing the viewer's value with a "–" rank when the API times out on the rank count (`viewer.rank: null`). The launcher drops such a viewer today; left for later since the production traces come from the missing backfill.
- The "x h to climb" hint for players outside the top 100 and the all-time cold cache (accepted today).
- Returning a real `total` from the API when the board size marker is missing: done on the API side in its own branch (session "hydra-api: total real em /leaderboards/me/games"). The launcher fix only stops showing a wrong one and shows the real one once the API sends it.
- CPU spike when a board has many Hydra Cloud banners (Eduardo, October 29): separate task, not required now.

## Changes by file

Launcher:

- `src/renderer/src/pages/leaderboards/global-leaderboard.ts`: `normalizeBadges` and `normalizeBadgeTarget` read `threshold`.
- `src/renderer/src/pages/leaderboards/global-leaderboard.test.ts`: badge fixtures with `threshold` + `value`.
- `src/renderer/src/pages/leaderboards/week-subtitle.tsx`: two lines for all time too.
- `src/renderer/src/pages/leaderboards/ranking-tab.tsx`: capped board size in "Top N of M players".
- `src/renderer/src/pages/leaderboards/stats-tab.tsx`: friends empty state uses the new title key.
- `src/renderer/src/pages/leaderboards/by-game-tab.tsx`: "of N" only with a known total, capped at "10,000+".
- `src/renderer/src/pages/game-details/leaderboard/leaderboard-row.tsx`: clear the inline tooltip position after the hide render, not before.
- `src/locales/{en,pt-BR,es,ru}/translation.json`: new title key, reworded description.

## API side (operations, no code)

1. Create the feature `GAME_LEADERBOARDS_EXTENDED` in the admin panel (Enabled, Everyone), like `GLOBAL_LEADERBOARDS`.
2. Run the activity backfill once on production, from the hydra-api checkout deployed there:

   ```bash
   pnpm backfill-leaderboard-activity --write
   ```

   Without `--write` it only reports. It walks users in batches of 500 (`--batch-size`), recomputes `UserStatsTotals`, `UserActivityTotals`, `LeaderboardActivityCredit` and the last 2 weeks (`--weeks`) of `UserPlaytimeWeek`/`UserActivityWeek`, locking each batch for at most 60 s. The all-time Redis boards expire within 6 h; to see the result at once, flush the `leaderboard:*` keys or wait.

## Local test

- `yarn test` on the leaderboards unit tests (badge normalizer).
- Build the launcher from the worktree, open Rankings: badges read "Top N%", header does not jump between Week and All time, friends streak card shows the new copy with friends but no streak. Screens shared for Eduardo's review before any commit.
