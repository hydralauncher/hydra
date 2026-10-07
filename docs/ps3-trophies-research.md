# PS3 trophies research

Research notes for adding PS3 trophy support to Hydra: where trophy data comes from, how RPCS3 stores it locally, and which sources can populate a localized trophy catalogue in hydra-api.

Status: research only. Nothing implemented.

## Summary

- **RPCN does not hold trophy definitions.** It only stores which trophies a user unlocked and when. Names, descriptions and icons must come from somewhere else.
- **Local unlock detection is language-independent.** RPCS3 identifies trophies by `(NPWR, trophyId)`. The parser can ignore text entirely and only emit IDs and timestamps.
- **The catalogue should come from Sony's PSN trophy API**, called server-side from hydra-api. It is the only source that has name, description, hidden flag, localization and unlock rate. No real third-party API covers all of these.
- **Unlock rate is the weak spot.** Sony only returns it when querying an account that owns the game. RPCN's earner counts are a fallback.

## RPCN (RPCS3's PSN replacement)

RPCS3 added online trophy sync through RPCN in August 2026. Profiles are viewable at `rpcs3.net/rpcn`.

### What the server stores

From [RipleyTom/rpcn](https://github.com/RipleyTom/rpcn) (v1.11.0):

- The trophy table is `user_trophies(user_id, communication_id, trophy_id, earned_at)`. `communication_id` is the trophy set ID, e.g. `NPWR00001_00`.
- Trophy definitions were deliberately removed from the server (commit "remove trophy definitions", May 2026).
- An optional JSON stats server (`src/server/stat_server.rs`) exposes:

| Path                           | Returns                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `/<path>/user/<npid>/trophies` | Per game: `communicationId`, `trophies: [{ trophyId, earnedAt }]`           |
| `/<path>/trophy/<NPWR>`        | `communicationId`, `uniquePlayers`, `trophies: [{ trophyId, earnerCount }]` |

`earnerCount / uniquePlayers` gives an unlock rate among RPCS3 players.

The stats server is disabled by default (`StatServer=false`, default path `rpcn_stats`). The public URL used by rpcs3.net is not in any repo, and it is unknown whether it is reachable from outside.

### What the rpcs3.net website uses

From [DAGINATSUKO/www-rpcs3](https://github.com/DAGINATSUKO/www-rpcs3) (GPL-2.0):

- Trophy names and descriptions come from `lib/module/rpcn/trophysets/<NPWR>.json`. These files exist only on their server and are not in the repo.
- `lib/module/rpcn/trophies.json` (in repo) maps each NPWR and trophy ID to an icon hash. Icons are served from `cdn/rpcn/trophies/<hash>.png`. 2,462 sets, 84,443 trophies.
- `lib/module/rpcn/games.json` (in repo) maps NPWR to title name and disc/PSN title IDs (e.g. `BLUS30001`). 2,759 entries. Useful to link Hydra's detected PS3 title IDs to trophy sets.
- The site calls the RPCN stats server from PHP and caches the result.
- rpcs3.net sits behind a Cloudflare bot challenge, so scraping it is not an option.

If we want RPCN data (rarity among emulator users, unlocks synced across devices), the clean path is asking the RPCS3 team for a public read-only endpoint or a data dump.

## How RPCS3 stores trophies locally

Per user, under `dev_hdd0/home/<user>/trophy/<NPWR>/`:

| File           | Contents                                                                            |
| -------------- | ----------------------------------------------------------------------------------- |
| `TROPCONF.SFM` | XML: trophy names, descriptions, grade, hidden flag. One language only (see below). |
| `TROPUSR.DAT`  | Binary: unlock state and timestamps.                                                |
| `TROP###.PNG`  | Trophy icons, named by trophy ID.                                                   |
| `ICON0.PNG`    | Trophy set icon.                                                                    |

The original archive is `TROPHY.TRP`, found in game files at `PS3_GAME/TROPDIR/<NPWR>/TROPHY.TRP`. It contains every language plus all icons.

### TROPCONF.SFM

```xml
<trophy id="005" hidden="no" ttype="G" pid="000">
  <name>...</name>
  <detail>...</detail>
</trophy>
```

- `id`: trophy ID, unique within the NPWR (not just the group).
- `hidden`: `yes` / `no`.
- `ttype`: `P` platinum, `G` gold, `S` silver, `B` bronze.
- `pid`: which platinum this trophy counts toward.
- DLC trophies are in extra `<group>` blocks. Updates append new IDs and never renumber existing ones.

### TROPUSR.DAT

Big-endian binary. Layout from RPCS3's `rpcs3/Loader/TROPUSR.h`:

- Header: magic `81 8F 54 AD`, table count, then table headers.
- Table type 4 (`TROPUSREntry4`): `trophy_id`, `trophy_grade` (1 platinum, 2 gold, 3 silver, 4 bronze), `trophy_pid`.
- Table type 6 (`TROPUSREntry6`): `trophy_id`, `trophy_state` (1 = unlocked), `timestamp1`, `timestamp2`.

Timestamps are `CellRtcTick` values: microseconds since 0001-01-01 UTC. Trophies synced down from RPCN are written with the same units.

```ts
const unixMs = (tick - 62135596800000000n) / 1000n;
```

Use `BigInt`; the value does not fit safely in a JS number.

## Languages

### Language files in a trophy set

`TROPHY.TRP` contains:

- `TROPCONF.SFM`: default text, usually English or the region's main language.
- `TROP.SFM`: optional alternative default.
- `TROP_XX.SFM`: one per additional language, where `XX` is the PS3 system language ID.

PS3 system language IDs (`CellSysutilLang`, from RPCS3's `cellSysutil.h`):

| ID  | Language              | ID  | Language                            |
| --- | --------------------- | --- | ----------------------------------- |
| 00  | Japanese              | 10  | Chinese (Traditional)               |
| 01  | English (US)          | 11  | Chinese (Simplified)                |
| 02  | French                | 12  | Finnish                             |
| 03  | Spanish               | 13  | Swedish                             |
| 04  | German                | 14  | Danish                              |
| 05  | Italian               | 15  | Norwegian                           |
| 06  | Dutch                 | 16  | Polish                              |
| 07  | Portuguese (Portugal) | 17  | Portuguese (Brazil), firmware 4.00+ |
| 08  | Russian               | 18  | English (UK), firmware 4.00+        |
| 09  | Korean                | 19  | Turkish, firmware 4.30+             |

Hydra's locales map to: `en` = 01, `es` = 03, `pt-BR` = 17, `ru` = 08. `pt-BR` is rare in older sets, so fall back to 07, then English.

### Languages vary per game

- **By release region.** Regional versions often have separate trophy sets with different NPWRs. A Japan-only release may only have Japanese; European releases often have many languages. Some regions share one NPWR (e.g. `NPWR00001_00` covers BCES, BLUS and NPEB versions).
- **By publisher.** Some sets are English only, others ship around ten languages.
- **Late languages.** IDs 17 and 18 came with firmware 4.00 and Turkish with 4.30, so older sets rarely have them.

### What RPCS3 installs

`sceNpTrophyRegisterContext` (`rpcs3/Emu/Cell/Modules/sceNpTrophy.cpp`, around lines 677-708):

1. Looks for `TROP_<lang>.SFM` matching the RPCS3 system language setting.
2. If found, renames it to `TROPCONF.SFM` and installs it.
3. Deletes every other `TROP_XX.SFM`.

So the installed trophy folder only has one language: whatever RPCS3 was set to when the game first ran. (The cleanup loop runs `0..18`, so a `TROP_19.SFM` survives and is installed too.)

## Parser design

The catalogue lives in hydra-api with all languages. Display follows the current Hydra language, the same way Steam achievements work. The local parser never reads trophy text.

Why this works:

- Within one NPWR, every language file describes the same trophies with the same IDs. Only `<name>` and `<detail>` differ; `id`, `hidden`, `ttype` and `pid` are identical.
- `TROPUSR.DAT` has no text, only numeric IDs and state.
- Icons are named by ID.

Parser steps:

1. List folders under `dev_hdd0/home/<user>/trophy/`. Folder name = NPWR.
2. Parse `TROPUSR.DAT`, collect each `trophy_id` with `trophy_state == 1` and its timestamp.
3. Emit `UnlockedAchievement` entries with `name = String(trophyId)` and `unlockTime` in ms.

Edge cases:

- **Key is `(NPWR, trophyId)`, not `(game, trophyId)`.** A Hydra game may need to link to several NPWRs (one per region).
- **DLC.** Trophy count per NPWR can grow after a game update. The catalogue must accept new IDs.
- **Hidden trophies.** Language files contain full text for hidden trophies. Hiding is Hydra's job, using the stored `hidden` flag.
- **Missing translations.** Record which languages exist per NPWR and fall back when displaying.

Hydra changes needed:

- `GameShop` (`src/types/game.types.ts`) has no PS3 value.
- `UserAchievement.source` only allows `"steam" | "retroachievements"`. Add `"rpcn"` or `"ps3"`.
- Map trophy grade to `points`.

## Catalogue sources

Requirements: API name, display name, description, unlock rate %, hidden flag, localized.

### Sony PSN trophy API v2 (recommended)

Unofficial, reverse-engineered from the PlayStation app. Wrapped by [psn-api](https://github.com/achievements-app/psn-api) (JS), [PSNAWP](https://github.com/isFakeAccount/psnawp) (Python) and psn-php. Documented by [andshrew/PlayStation-Trophies](https://github.com/andshrew/PlayStation-Trophies/blob/master/docs/APIv2.md).

Base URL: `https://m.np.playstation.com/api/trophy`

| Requirement  | Field                                                  | Notes                                                                                                        |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| API name     | `trophyId`                                             | Numeric, 0-based, same as TROPCONF `id` and the `TROPUSR.DAT` index. PS3 trophies have no string identifier. |
| Display name | `trophyName`                                           |                                                                                                              |
| Description  | `trophyDetail`                                         |                                                                                                              |
| Hidden       | `trophyHidden`                                         | The title endpoint returns full text for hidden trophies.                                                    |
| Localized    | `Accept-Language` header                               | One language per request.                                                                                    |
| Unlock rate  | `trophyEarnedRate` (e.g. `"8.0"`), `trophyRare` (tier) | Global across all PSN players. See caveat below.                                                             |

Also available: `trophyType`, `trophyIconUrl`, `trophyGroupId`, `trophySetVersion`.

Endpoints:

1. **Definitions**, works for any trophy set:
   `GET /v1/npCommunicationIds/{NPWR}/trophyGroups/all/trophies?npServiceName=trophy`
2. **Unlock rate**, only when `{accountId}` has the game synced and its trophy list is visible to the caller (otherwise `Resource not found`):
   `GET /v1/users/{accountId}/npCommunicationIds/{NPWR}/trophyGroups/all/trophies?npServiceName=trophy`

PS3, PS4 and Vita sets require `npServiceName=trophy`. The rate is global, so any owning account returns the same number.

Caveats:

- **Auth.** Needs an NPSSO token from a real PSN account. Refresh token lasts about 2 months.
- **Rate limit.** About 300 requests per 15 minutes per account.
- **Ban risk.** PSNAWP warns excessive use can get the account temporarily or permanently banned. Use a dedicated account, never a user's.
- **Unlock rate needs an owner per NPWR.** Options: a dedicated account, public profiles found through Sony's user search, or RPCN's `earnerCount / uniquePlayers` as fallback (RPCS3 players only).
- **PS3 localization is unverified.** The docs only demonstrate `Accept-Language` on a PS5 title, and the response does not say which language it returned. A missing translation silently falls back to the default text. Test a multi-language European PS3 set in `pt-BR` and `ru` before committing.
- **Legacy v1 API** (`gb-tpy.np.community.playstation.net`) returned rates for any title via `fields=@default,trophyEarnedRate` and `npLanguage`. Its token path died with my.playstation.com in June 2021. Treat as gone.

### Other options

| Option                                                                 | Verdict                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PSN Leaderboard API](https://www.psnleaderboard.com/api/) ($20/month) | Covers PS3, Vita and PS4 and lists 20 languages. Docs show per-game counts, `average_perc` and `available_languages`, but not per-trophy fields. Rarity source unclear. Needs a trial to confirm. Resells PSN data.                                                         |
| Exophase                                                               | No public definitions API. Existing integrations (e.g. [PlayniteAchievements](https://github.com/justin-delano/PlayniteAchievements)) scrape HTML through a browser view with Cloudflare cookies. Rarity is among Exophase users only. Localization not usable. Not viable. |
| PSNProfiles / TrueTrophies                                             | No API. Scraping only, behind Cloudflare, mostly English. Not viable.                                                                                                                                                                                                       |
| [PlatPrices](https://platprices.com/developers.php)                    | PS4 and PS5 trophy data only. No PS3.                                                                                                                                                                                                                                       |
| rpcs3.net                                                              | Text not public. Only the icon map and NPWR-to-title-ID map are usable.                                                                                                                                                                                                     |

## Proposed pipeline (hydra-api)

1. Take the NPWR list from RPCS3's `games.json` (2,759 sets).
2. Per NPWR, call the title trophies endpoint once per Hydra language: `en-US`, `es-ES`, `pt-BR`, `ru-RU`.
3. Store per `(NPWR, trophyId)`: grade, hidden, group, icon, and `{ [lang]: { name, detail } }`.
4. Unlock rate: Sony's rate where an owning account exists, otherwise RPCN's. Store which source each rate came from.
5. Cache aggressively and refresh rarely. PS3 sets almost never change.

Seeding about 2.5k sets in 4 languages is about 12.5k calls, roughly 10 hours on one account at the rate limit.

Copyright note: storing Sony and publisher trophy text and icons carries the same risk as the Steam achievement icons Hydra already hosts.

## Open questions

- Does `Accept-Language` return translated text for PS3 sets?
- Will the RPCS3 team expose a public RPCN stats endpoint?
- How do we find an owning PSN account per NPWR for unlock rates at scale?
- Should Hydra show Sony's global rate, RPCN's emulator rate, or both?

## Sources

- [RPCS3 blog: Online PS3 trophies have arrived on PC](https://blog.rpcs3.net/2026/08/25/online-ps3-trophies-support-has-arrived-on-pc/)
- [RipleyTom/rpcn](https://github.com/RipleyTom/rpcn)
- [DAGINATSUKO/www-rpcs3](https://github.com/DAGINATSUKO/www-rpcs3)
- [RPCS3/rpcs3](https://github.com/RPCS3/rpcs3): `rpcs3/Loader/TROPUSR.h`, `rpcs3/Emu/Cell/Modules/sceNpTrophy.cpp`, `rpcs3/Emu/Cell/Modules/cellSysutil.h`
- [andshrew/PlayStation-Trophies API v2](https://github.com/andshrew/PlayStation-Trophies/blob/master/docs/APIv2.md) and [API v1](https://github.com/andshrew/PlayStation-Trophies/blob/master/docs/APIv1.md)
- [achievements-app/psn-api](https://github.com/achievements-app/psn-api) and [title trophies docs](https://psn-api.achievements.app/api-docs/title-trophies)
- [PSNAWP docs](https://psnawp.readthedocs.io/en/latest/) and [isFakeAccount/psnawp](https://github.com/isFakeAccount/psnawp)
- [PSN Leaderboard API](https://www.psnleaderboard.com/api/)
- [PlatPrices developers](https://platprices.com/developers.php)
- [justin-delano/PlayniteAchievements](https://github.com/justin-delano/PlayniteAchievements)
