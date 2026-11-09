# Combined Steam/Epic achievement presentation

The optional combined request has a five-second timeout. Source-only update
events from other copies are ignored on fallback; only the operational copy may
replace that page's source-specific list. Library totals and unlocked counts are
both derived from the returned list, and rejected requests retain the existing
count pair.

Requires the API's `/profile/achievements/combined` endpoint and its additive
canonical achievement identity migration. The API groups equivalent provider
definitions and applies the existing owner/session/subscription visibility rules.

The launcher displays the union of the owner's variants, preferring Steam only
when the equivalent achievement is unlocked there. An Epic-only unlock stays
Epic. Distinct achievements stay separate; original localized names are kept.
Both provider timestamps remain in `sources`.

Unsynced local unlocks are matched only within their original store and game.
The original selected-copy catalogue, remote-unlock and souvenir refresh always
runs first, including when the combined response succeeds. This keeps source
caches current for subsequent detection/sync without importing the union into them.
The combined list is a read-only presentation projection: it never writes into
`AchievementMemoryStore`, uploads one store's unlocks to another, or changes
Steam/Epic synchronization. API absence/failure falls back to the previous
single-store flow. Hidden locked descriptions remain hidden and list keys use the
canonical achievement UUID. Grouped game pages listen to updates from both stores;
large library cards use the union's counts when available. Global API statistics,
feeds and cross-profile comparison remain unchanged.

Deploy the API migration/endpoint first. Real-account staging validation must
check X+Y, duplicate X+X, Epic-only unlocks, local unsynced progress and offline
fallback before shipping the launcher.
