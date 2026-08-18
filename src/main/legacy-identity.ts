import { app } from "electron";

/**
 * Keeps Electron's internal app name (and therefore app.getPath("userData"))
 * pointing at the pre-rename "Hydra" identity, even though the visible
 * product name is now Medusa.
 *
 * Why this file exists and why it's imported first:
 * Electron derives app.getPath("userData") from the app name the first
 * time it's asked, and several modules in this codebase (constants.ts,
 * via the level/logger/services import chain) read that path as a
 * top-level `export const` — meaning it's read the instant those modules
 * are imported, not lazily. app.setName() only takes effect for calls to
 * app.getPath() that happen AFTER it runs, so it must execute before any
 * of those modules are imported anywhere in the chain.
 *
 * This file has no other imports of its own, so importing it is the
 * fastest possible thing index.ts can do — nothing can get to
 * app.getPath("userData") before this line runs.
 *
 * Do not rename/move this call without re-tracing the import graph from
 * src/main/index.ts (see src/main/constants.ts for the paths this
 * protects: hydra-db, hydra-db-staging, CommonRedist, logs, Backups,
 * Assets, themes).
 */
app.setName("Hydra");
