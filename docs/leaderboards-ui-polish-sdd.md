# Rankings page polish and Epic game boards

SDD written on October 28, 2026. Status: approved and reviewed locally against staging data by Eduardo on October 28, 2026. No Linear task.

Base: launcher `03e1ea87d` (`origin/main`), branch `feature/leaderboard-ui-polish`. Backend `cf10006e` (`origin/main`), branch `fix/epic-game-leaderboard`.

## Expected result

The Rankings page looks like the rest of the launcher instead of a separate product:

1. "Your stats" shows play activity as a full-width, year-long heatmap, read like a contribution graph: one column per week, month names on top, weekday names on the left, a "Less / More" legend and a total under it. The colors stay the same.
2. The "Leaders of the week" cards no longer cut off every label and name.
3. The Reviews metric keeps its ranking (podium, rows, selection, hover tooltip and "Show more"); only the highlighted review above it is redrawn like a review on the game page.
4. Epic games show everyone who played them on the per-game boards, including playtime imported from the Epic library, the same way Steam games already do.

## Requested changes

| Request (Eduardo, October 28)                                   | How it is met                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heatmap in "Your stats" like the reference, keeping our colors  | New full-width "Activity" card at the top of "Your stats" with 53 weeks, month and weekday labels, legend and total. The four `leaderboards__heat--*` levels and colors stay as they are. |
| Epic playtime is not counted, only Steam                        | Backend per-game boards match Epic games by catalogue, not by the exact `objectId`, so imported Epic rows count.                                                                          |
| Reviews on the Rankings page do not match the game page reviews | The highlighted review above the Reviews ranking is redrawn with the game page review styles (`review-item.scss`). The ranking itself does not change.                                    |
| Leader cards and the page feel off compared with the rest       | Leader cards move to a wrapping grid (4 per row at desktop width) so labels, names and values fit.                                                                                        |

## Diagnosis: Epic boards

Checked on production on October 28, 2026:

- `GET /games/steam/730/leaderboards/playtime?range=all` tops at 23,199,240 s (6,444 h), so imported Steam playtime counts.
- `GET /games/epic/fn:48ff3f41680e403bb2717737f68731c5/leaderboards/playtime?range=all` (Fortnite) tops at 34,225 s (9.5 h). A library with 1,859 h of imported Fortnite playtime does not show up.

Cause: the Epic catalogue identifies a game by its offer (`namespace:offerId`, here `fn:48ff…`). Games imported from the Epic library are stored as `namespace:catalogItemId` (`epicGameObjectId` in `epic-snapshot-publication.service.ts`). The two are linked through `GameCatalogue.epicExecutableObjectId`, published `epic_regional_identity` store mappings and `Game.gameCatalogueId`. The per-game boards (`game-playtime.board.ts`, `game-sessions.board.ts`, `game-souvenirs.board.ts` and `gameAggregateBranchSql`) filter on `g."objectId" = ${objectId}`, so only rows stored under the offer id are ranked. Imported rows never are. Steam has a single id per game, so it is not affected.

## Decisions

| Topic              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic identity      | For `shop = "epic"`, the board resolves the published catalogue once (`resolvePublishedCatalogueStore`, already called in `GameLeaderboardsService`) and matches rows by `g."gameCatalogueId" = <catalogue id>` instead of `objectId`. Other shops keep the `objectId` filter.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| One value per user | A user can have more than one Epic row for the same catalogue (one added from the catalogue, one imported). The board takes each user's largest value (`MAX ... GROUP BY userId`), so time is never counted twice. The cost is that Hydra-tracked time on a separate row is not added to imported time. Summing would risk counting the same hours twice, which is worse on a ranking.                                                                                                                                                                                                                                                                                                                                                   |
| Weekly boards      | `GamePlaytimeWeek` and the other weekly tables are keyed by `shop` and `objectId`. They join `Game` and filter on the catalogue the same way. Imported time has no weekly deltas, so weekly boards only gain users whose tracked rows were stored under the item id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Cache keys         | Epic boards are cached under the catalogue's offer id, so the page and the "my games" list share one cache entry. Invalidation also clears that key when a row under the item id changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Heatmap range      | 53 weeks, the current one included. The backend cap `LEADERBOARD_PLAY_ACTIVITY_MAX_WEEKS` goes from 26 to 53. Days come from `UserGamePlaytimeDay`, which has no retention job. The launcher asks for 53 weeks and, if the API answers 400 (old backend), asks again with 26, so the launcher can ship before the backend. When the fallback answers, the grid, month labels and total use the 26 weeks that came back, not 53. Only a 400 triggers the fallback, and it is remembered for the session; it is marked to be removed once the backend change is deployed.                                                                                                                                                                  |
| Heatmap layout     | Its own full-width card ("Activity"), the first block of "Your stats", with the current and best streak in its header (flame after the numbers). The separate "Daily streak" card is removed; "Your week" and the friends streak sit side by side below. Square cells of 12 px with 3 px gaps, scrolled horizontally inside the card when the window is narrower than 53 columns, starting scrolled to today. Weekday labels on Mon, Wed and Fri only. Month label on the first week that starts in that month.                                                                                                                                                                                                                          |
| Heatmap summary    | Under the grid, left: "128 h in 74 days" for the shown range. Right: "Less ▢▢▢▢ More". Zero days is always plural ("0 dias"). Month and weekday labels start with a capital letter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Heatmap tooltip    | The tooltip added in #2989 stays (today and yesterday labels, games of the day). It follows the new orientation: tips in the first and last two columns open inward, tips in the top two rows open below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Leader cards       | `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` instead of one row of equal columns. Label on one line, then avatar, name and value. At 1280 px that is 4 per row, 2 rows for the 8 metrics (180 px gave 5 per row, checked on screen).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Highlighted review | Reviews keeps the ranking from main: podium, rows, row selection on the podium, the hover tooltip on rows and "Show more". Only the highlighted panel above the board changes. Above it, as plain text with the trophy and no box, the title from main: "Most upvoted review of the week", "... of all time" or "... by {name}". Below, the review drawn like one on the game page (`review-item.tsx`): the author's profile banner when there is one, 56 px avatar, name, filled star with the score and the rating text, relative date at the top right, a "{game} →" link line to the game page, the text clamped to 5 lines and the vote count in the game page votes row. No cover footer. It follows the selected entry as before. |
| Review styles      | Reuse `review-item.scss` classes from the game page (`game-details__review-*`) for the banner, header, stars, text and votes row, so both screens change together. The 5-line clamp lives on `leaderboards__review-text` only, so the game page still shows reviews in full. The card has no vote buttons, replies or translation, because the leaderboard payload has no review id.                                                                                                                                                                                                                                                                                                                                                     |
| Strings            | New keys in `en`, `pt-BR`, `es` and `ru` (`activity_title`, `activity_total`, `legend_less`, `legend_more`, `badge_amount_sessions`, `badge_remaining_to_top_rank`, `badge_remaining_to_top_percent`), with `_few`/`_many` in `ru` and `_zero` forms in `pt-BR`, where `Intl.PluralRules("pt")` puts 0 in `one`. Unused keys (`last_weeks`, `legend_min`, `legend_max`, `review_open_game`) are removed from every locale. The `review_top_*` titles stay.                                                                                                                                                                                                                                                                               |

## Out of scope

- A year selector on the heatmap, as in the reference. One rolling year only.
- Counting the imported Epic total into the weekly boards. Imports have no dates.
- Changing the Epic import to store rows under the offer id.

## Changes by file

Launcher:

| File                                                             | Change                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/pages/leaderboards/stats-tab.tsx`              | Activity card, month labels, total, fallback to 26 weeks; streak numbers moved into the Activity header. |
| `src/renderer/src/pages/leaderboards/global-leaderboard.ts`      | `PLAY_ACTIVITY_WEEKS = 53`, `buildHeatmapMonths`, `sumHeatmap`.                                          |
| `src/renderer/src/pages/leaderboards/ranking-tab.tsx`            | Highlighted review rendered by `ReviewHighlight`; 8 leader card placeholders.                            |
| `src/renderer/src/pages/leaderboards/review-highlight.tsx`       | New: the highlighted review card in the game page style.                                                 |
| `src/renderer/src/pages/leaderboards/leaderboards.scss`          | Activity card, heatmap orientation, leader card grid, highlighted review card.                           |
| `src/locales/*/translation.json`                                 | New and removed keys.                                                                                    |
| `src/renderer/src/pages/leaderboards/global-leaderboard.test.ts` | Tests for month labels and totals.                                                                       |

Backend:

| File                                                                                    | Change                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/constants/leaderboard.ts`                                                          | `LEADERBOARD_PLAY_ACTIVITY_MAX_WEEKS = 53`.           |
| `src/games/game-leaderboards.service.ts`                                                | Pass the resolved catalogue id for Epic to the board. |
| `src/games/game-playtime.board.ts`, `game-sessions.board.ts`, `game-souvenirs.board.ts` | Epic filter by catalogue, `MAX` per user.             |
| `src/leaderboards/leaderboard-eligibility.ts`                                           | `gameAggregateBranchSql` takes the same game filter.  |
| `src/leaderboards/game-leaderboard-registry.ts`                                         | Cache key and invalidation for Epic item ids.         |

## Tests

Automated:

- Launcher (`global-leaderboard.test.ts`): month labels land on the first week of each month; the total sums seconds and counts played days; 53 weeks end on the current week.
- Backend: an Epic user with an imported row under the item id ranks on the offer id board; a user with both rows appears once with the larger value; Steam boards are unchanged.

Local, before any commit (launcher dev against the local backend):

1. Your stats: the Activity card shows a year, months and weekdays line up, hover tooltips stay inside the card, narrow window scrolls and starts at today.
2. Ranking: the 8 leader cards show full labels and names.
3. Reviews metric: the ranking is unchanged, selecting a podium entry swaps the highlighted review, the row tooltip shows on hover and the game link opens the game page.
4. Fortnite page and "By game" tab: the imported Epic playtime ranks.
5. Screens shared with Eduardo for review. No commit, push or PR until approved.

## Addendum: game badges (October 28, 2026)

Requested by Eduardo during the local review. Today `GET /users/me/leaderboard-badges` always answers an empty list ("Badge rules are not defined yet"), so "Suas insígnias" never shows anything. The launcher section (`badges-section.tsx`) and its contract already exist and follow the prototype (`LeaderboardsF.dc.html`, "Suas insígnias").

### Rules

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which badges  | Game badges only. Kinds `top_rank` (Top 1, Top 5, Top 10 by position) and `top_percent` (Top 1%, Top 5%, Top 10%). The other kinds in the contract (`weekly_leader`, `friends_podium`, `streak_record`) stay unused.                                                                                                                                                                                                                   |
| Boards        | The per-game all-time global boards: playtime, sessions and souvenirs. Epic games use the catalogue identity from this change.                                                                                                                                                                                                                                                                                                         |
| Minimum       | A game only gives badges when its board has at least 100 ranked players (`LEADERBOARD_BADGE_MIN_PLAYERS = 100`).                                                                                                                                                                                                                                                                                                                       |
| One per game  | Each threshold is a rank: 1, 5, 10, and `ceil(players × 1%)`, `ceil(players × 5%)`, `ceil(players × 10%)`. For each game and metric the user earns the highest tier their rank qualifies for, then, within that tier, the badge with the smaller rank (with 5,000 players, Top 1% is rank 50, so both #2 and #11 earn "Top 1%", gold, instead of #2 getting "Top 5", silver); at the same rank, position wins ("Top 5" over "Top 5%"). |
| Tiers         | Gold for Top 1 and Top 1%, silver for Top 5 and Top 5%, bronze for Top 10 and Top 10%. These map to the existing `gold`, `silver` and `bronze` styles.                                                                                                                                                                                                                                                                                 |
| Locked badges | For games the user plays that pass the minimum but where they hold no badge yet, or could reach a stronger one, the next badge is shown locked, with `progress` = the user's value and the value at the target rank. Up to 8 locked badges, the closest ones first.                                                                                                                                                                    |
| Locked text   | The meta line names the target: "Faltam 4 h para o Top 10", "Faltam 3 sessões para o Top 5%". Keys `badge_remaining_to_top_rank` and `badge_remaining_to_top_percent` (singular "Falta"), plus `badge_amount_sessions` used only in this line, in `en` and `pt-BR`. Boards and cards keep showing sessions as a bare number.                                                                                                           |
| Earned date   | `earnedAt` is when the badge was first seen. It is stored per user, game, metric and kind so it survives, and a badge that is lost later disappears.                                                                                                                                                                                                                                                                                   |
| Where         | Only in "Suas estatísticas", as today.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Cost          | Computed per viewer from the cached boards, cached for 10 minutes. Only the viewer's 30 most played games are checked.                                                                                                                                                                                                                                                                                                                 |

### Changes by file

| Repository | File                                                     | Change                                                                                            |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Backend    | `src/leaderboards/leaderboard-viewer.service.ts`         | `getLeaderboardBadges(viewerId)` with the rules above.                                            |
| Backend    | `src/leaderboards/leaderboard-viewer.controller.ts`      | Real schema for the response instead of the empty list.                                           |
| Backend    | `src/constants/leaderboard.ts`                           | Minimum players, thresholds, locked badge limit and cache time.                                   |
| Backend    | `prisma/schema.prisma` + migration                       | `UserLeaderboardBadge` (userId, shop, objectId, metric, kind, value, firstSeenAt) for `earnedAt`. |
| Launcher   | `src/renderer/src/pages/leaderboards/badges-section.tsx` | Locked text with the target, chip labels for Top N and Top N%.                                    |
| Launcher   | `src/locales/en/translation.json`, `pt-BR`               | `badge_remaining_to`.                                                                             |

### Tests

- Backend, in `sdd-local`: a game with 99 players gives no badge; with 100, rank 1 gives Top 1 gold; with 1,000 players rank 8 gives Top 1% gold, rank 40 gives Top 5% silver and rank 90 gives Top 10% bronze; with 5,000 players #2 and #11 give Top 1% gold and the next target for #11 is Top 1; a locked badge carries the value at the target rank; `earnedAt` stays the same across calls.
- Local, against the staging data: Eduardo's "Suas estatísticas" shows his real badges.
