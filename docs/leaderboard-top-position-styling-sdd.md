# Top position styling for leaderboards (LBX-1267)

SDD written on October 21, 2026, revised on October 22, 2026 after review. Status: implemented, in review in PR #2959.

Base: launcher `be492f5e3`, branch `feat/LBX-1267-leaderboard-top-position-styling`. Visual references: the "Game Ranking Card" prototype (boards "Game page sidebar · Ranking", "View all · Full board" and "Ranking states") and the launcher Design System.

## Expected result

Every leaderboard in the launcher highlights the top positions the same way. The first three get gold, silver and bronze medals, each with a ribbon, a rim and a shine that sweeps across it from time to time. Their rows get an animated ring in the medal color. Ranks 4 to 10 show a stronger number than the rest. The styling works with custom themes and respects the system's reduced motion setting.

This change ships the reusable building blocks. The first screen to use them is the game page board (LBX-1266). The global leaderboards page (LBX-1265) uses the same components. Gamification is not a dependency, following Hélio's decision recorded on the task.

## Task acceptance criteria

| Linear criterion                                                                                          | How it is met                                                                                                                                                                                                                                                                                                                      | Status                  |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Distinct gold/silver/bronze treatment (color, rank icon, subtle glow) for ranks 1 to 3                    | Each of the three ranks has its own color and an SVG medal with the number. The subtle glow is a `drop-shadow` in the medal color.                                                                                                                                                                                                 | Met                     |
| Lighter accent for the top 10                                                                             | Ranks 4 to 10 show the number at full text color and weight 800. Other ranks use 55% of the text color and weight 700. There is no medal.                                                                                                                                                                                          | Met                     |
| Applied consistently on the global page, the game page board and the friends views                        | One set of components (`RankMedal`, `RankFrameRing`, `rank-frame`) for every view. The game page board and the friends view come with LBX-1266, and the global page with LBX-1265.                                                                                                                                                 | Met once LBX-1265 lands |
| Works with existing themes (theme CSS variables where possible, readable on light and dark custom themes) | The theme system defines no color variables besides `--color-primary`. All ranking colors are custom properties (`--rank-*`) with fallbacks that theme CSS can override, and the BEM class names are stable. Plain numbers follow the row text color. The number on the medal is dark on a light disc, readable on any background. | Met                     |
| Built inside the Leaderboards project, not dependent on Gamification                                      | No Gamification imports or data.                                                                                                                                                                                                                                                                                                   | Met                     |

## Decisions

| Topic          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components     | `RankMedal` and `RankFrameRing` in `src/renderer/src/components/rank-medal/`, exported from `components/index.ts`. `RankMedal` takes `rank` and an optional `highlighted`.                                                                                                                                                                                                                                                                                                                                                                   |
| Tier rule      | Pure `getRankTier(rank)`: 1 → `gold`, 2 → `silver`, 3 → `bronze`, 4 to `TOP_RANK_ACCENT_CUTOFF` (10) → `top10`, anything else or invalid → `default`.                                                                                                                                                                                                                                                                                                                                                                                        |
| Colors         | Prototype values as SCSS variables in `globals.scss` (`$rank-gold-color` and so on). In the compiled CSS they are fallbacks of custom properties (`--rank-gold-color`, `--rank-gold-ribbon` and so on) that themes can override.                                                                                                                                                                                                                                                                                                             |
| Medal          | Inline 24×26 SVG from the prototype. The rank number is an SVG `<text>` centered on the disc.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Glow           | `filter: drop-shadow(0 0 4px …)` in the medal color at about 45% opacity. This is the "subtle glow" the task asks for. It is static.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Shine          | The prototype's diagonal streak sweeps every `$medal-shine-duration` (3.6 s), staggered by rank (`MEDAL_SHINE_STAGGER_SECONDS`). It animates `transform: translateX()` only, so it stays on the compositor and never triggers layout.                                                                                                                                                                                                                                                                                                        |
| Top three ring | The row gets `rank-frame rank-frame--gold/silver/bronze` and renders `RankFrameRing`. The ring container holds a static soft tint in the medal color and is masked down to a 1.5 px border. Inside it, a larger element carrying a static `conic-gradient` (medal color with a white highlight) rotates with `transform: rotate()` every `$frame-spin-duration` (4.5 s). Silver and bronze start offset by a third and two thirds of a turn. Only `transform` is animated, so there is no per-frame style recalculation or gradient repaint. |
| Reduced motion | `prefers-reduced-motion: reduce` stops the shine and the ring spin. The glow and the static ring stay.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Accessibility  | The medal has `role="img"` and a translated label ("1st place, gold"). Color is never the only signal, because the number stays visible.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Strings        | New `leaderboard` namespace in `en` and `pt-BR`. Other languages fall back to English, which is the configured fallback.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Backend        | No changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Out of scope

- Profile banners on rows, which belong to LBX-1266.
- The "Hydra paw" animation on the Play button. It is in the prototype, but it is not part of the leaderboards.
- A "you" marker on the medal itself when the viewer is in the top three. The row's "You" tag already covers it.

## Changes by file

| File                                                                    | Change                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/renderer/src/components/rank-medal/rank-tier.ts`                   | Tier rule, cutoff and types.                                                  |
| `src/renderer/src/components/rank-medal/rank-medal.tsx`                 | `RankMedal` and `RankFrameRing`.                                              |
| `src/renderer/src/components/rank-medal/rank-medal.scss`                | Medal, shine, ring, animations and reduced motion.                            |
| `src/renderer/src/components/index.ts`                                  | Exports.                                                                      |
| `src/renderer/src/scss/globals.scss`                                    | Six medal color variables.                                                    |
| `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json` | `leaderboard` namespace with `medal_gold`, `medal_silver` and `medal_bronze`. |

## Tests

Automated (`node:test`, in `rank-tier.test.ts`):

- 1, 2 and 3 map to gold, silver and bronze.
- 4 and 10 map to `top10`, and 11 maps to `default`.
- 0, negatives, decimals and `NaN` map to `default`.
- `isMedalTier` only matches the three podium tiers.

Coverage of `rank-tier.ts` is 100%. The visual components are checked by hand, since the repository has no rendering tests.

Manual checks:

- The medals and ring match the prototype on the default theme.
- With the `Light`, `White`, `Dark` and `All Black` themes, and with a simulated theme that lightens the card and overrides the gold color, every number stays readable.
- In the running page, the only animated property is `transform`.
- With reduced motion turned on, the shine and the ring spin stop.
