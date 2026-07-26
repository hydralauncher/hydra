# Hydra Hybrid Patch — Maintenance Guide

A complete reference for the hybrid fork: what was changed, why, and how to re-apply the patch when upstream Hydra ships a new release. Read this end-to-end before merging upstream.

---

## 1. What This Fork Does

**Kept from upstream Hydra:**
- Catalogue, library, achievements, friends, download sources (all public/free endpoints)
- Torrent engine (Python RPC), game detection, notifications, UI

**Replaced with Google Drive:**
- Cloud saves (game save uploads/downloads)
- Custom profile avatars (including animated WebP/GIF)
- Custom profile banners
- Custom game artwork (library icon overrides)
- Emulation saves

**Subscription:** Hydra Cloud subscription check is hardcoded to `active` in the client so the paywalled UI unlocks. All routes that would normally hit Hydra's paid endpoints are hijacked by a custom axios adapter and routed to Drive instead.

---

## 2. Branch Layout

- `main` — the hybrid fork (client-only, Drive-backed)
- `self-hosted-server` — abandoned Node/Fastify server (kept for reference only)
- `upstream` remote → `https://github.com/hydralauncher/hydra.git`

Set the remote once:
```bash
git remote add upstream https://github.com/hydralauncher/hydra.git
```

---

## 3. Merge Workflow (when upstream releases)

```bash
git fetch upstream main
git checkout -b merge/upstream-$(date +%Y-%m-%d)
git merge upstream/main
```

Resolve conflicts using the file-by-file map in §5. Then:

```bash
yarn install
yarn typecheck
yarn dev            # smoke-test on Windows if possible
```

Run through the verification checklist in §7. When green:

```bash
git checkout main
git merge --ff-only merge/upstream-YYYY-MM-DD
git push origin main
```

To cut a release from the merged `main`, follow §12.

---

## 4. Files We Own (new — no merge conflicts unless upstream lands at the same path)

| Path | Purpose |
|---|---|
| `src/main/services/hydra-hybrid-adapter.ts` | Custom axios adapter that hijacks Hydra API endpoints and routes them to Drive. Exports `createHybridAdapter(defaultAdapter)`. |
| `src/main/services/hybrid-axios.ts` | Shared axios instance carrying the hybrid adapter, used for direct `axios.put(presignedUrl, …)` calls. |
| `src/main/services/drive/drive-oauth.ts` | OAuth 2.0 loopback + PKCE. Stores client ID and refresh tokens in Level DB. |
| `src/main/services/drive/drive-client.ts` | Google Drive v3 REST wrapper: upload, download, delete, list, makePublic, about. |
| `src/main/services/drive/drive-storage.ts` | High-level operations: `uploadProfileAsset`, `uploadCustomArtwork`, `uploadSaveArtifact`, `uploadEmulationSaves`. Also owns the local disk cache under `ASSETS_PATH/hybrid/`. |
| `src/renderer/src/pages/settings/settings-cloud-storage.tsx` | Settings UI: client ID input, connect/disconnect Drive, storage status. |
| `docs/HYBRID_SETUP.md` | End-user Google Cloud OAuth setup walkthrough. |
| `docs/HYBRID_PATCH_GUIDE.md` | This file. |

---

## 5. Files We Modified (conflict-prone during merge)

### 5.1 `src/main/services/hydra-api.ts` — **HIGH RISK** (upstream churns this a lot)

Additions to preserve:

- Import `createHybridAdapter` and `applyHybridProfileOverrides` from `./hydra-hybrid-adapter`.
- Constant `HYBRID_SUBSCRIPTION_PAYLOAD`:
  ```ts
  { expiresAt: "9999-12-31T23:59:59.000Z", status: "active" }
  ```
- Override `hasActiveSubscription()` to always return `true`.
- Wire the hybrid adapter into the axios instance:
  ```ts
  base.defaults.adapter = createHybridAdapter(base.defaults.adapter as any);
  ```
- Response interceptor for `/profile/me`, `/profile`, and `/users/:userId` (own user only) that calls `applyHybridProfileOverrides(response.data)`.
- Static field `HydraApi.currentUserId: string | null`.
- In `setupApi()`, seed `currentUserId` from Level DB **before** the first request fires (avoids race on `/users/:userId` firing before `/profile/me`).
- Clear `currentUserId` on sign-out.
- Delete any dead `validateOptions` subscription-gate check.
- Optional debug logs prefixed `[hybrid override]` — remove before shipping.

**Symptoms if merge drops these:** paywalled UI relocks, profile image shows the placeholder, or every request 500s with `Cannot read properties of undefined (reading 'data')` (see §6.1).

### 5.2 `src/main/services/python-rpc.ts`

Additions:
- `unavailableForSession: boolean` flag on the class.
- `MAX_SPAWN_FAILURES = 3` — after N consecutive failures, set `unavailableForSession = true`.
- `public static isUnavailable(): boolean` getter.
- Guard at the top of `spawn()` and `request()` — throw immediately when unavailable so callers stop retrying.

### 5.3 `src/main/services/download/download-manager.ts`

- `getDownloadStatusFromRpc()` and `getSeedStatus()` check `PythonRPC.isUnavailable()` and return early with no log.
- Prevents infinite polling spam on machines without Python.

### 5.4 `src/main/main.ts`

- Wrap `DownloadManager.startRPC(...)` in try/catch inside `loadState()`.
- Without this, an RPC startup failure hangs the await and `createMainWindow()` never runs, so the app looks like it silently fails to start.

### 5.5 `src/main/level/sublevels/keys.ts`

Add key builders:
- `driveOAuthClient`
- `driveAuth`
- `driveRootFolderId`
- `driveProfileImageUrl`
- `driveBackgroundImageUrl`
- `driveSaveArtifacts(shop, objectId)`
- `driveEmulationSaves`
- `driveCustomArtwork(shop, objectId, kind)`

### 5.6 `src/renderer/src/context/settings/settings.context.tsx`

- Add `"cloud_storage"` to the `SettingsCategoryId` union.
- Add `"cloud_storage"` to the `isSettingsCategoryId` runtime array.

### 5.7 Upload call sites (route through `hybridAxios`)

- `src/main/services/update-profile.ts`
- `src/main/services/game-artwork-cloud.ts` (or wherever custom artwork PUT lives)
- `src/main/services/emulation-cloud-saves.ts`

Each one imports the shared `hybridAxios` from `hybrid-axios.ts` and uses it for the PUT to the presigned URL so the adapter can catch `hydra-hybrid://` URLs.

---

## 6. Concepts & Common Pitfalls

### 6.1 Axios 1.x adapter is an array, not a function

`base.defaults.adapter` looks like `['xhr', 'http', 'fetch']`. If you pass it directly to your wrapping adapter, every request fails with:

> Cannot read properties of undefined (reading 'data')

Resolve it once at adapter creation:
```ts
const resolved = axios.getAdapter(defaultAdapterConfig as any);
```

### 6.2 Hydra rejects `null` for image fields

The `/profile` zod schema is `string | undefined`, not `string | null`. When clearing a field:

- ❌ `body.profileImageUrl = null` → HTTP 400 `Expected string, received null`
- ✅ `delete body.profileImageUrl`

`normalizeProfilePatch` in `hydra-hybrid-adapter.ts` deletes the key when the value starts with `hydra-hybrid-uploaded://`.

### 6.3 `/users/:userId` interceptor race

The profile page fires `/users/:userId` before `/profile/me` on cold boot. If `currentUserId` is null, the interceptor won't recognize the request as "self" and won't apply the override. Fix: seed `currentUserId` from Level DB in `setupApi()`.

### 6.4 Google throttles hotlinks + Chromium ORB blocks them

`lh3.googleusercontent.com/d/<fileId>` returns HTTP 429 for personal Google accounts under mild load, and Chromium's Opaque Response Blocking drops the response because it lacks CORS headers. No URL variant fixes this.

**Solution:** After uploading to Drive, write the raw bytes to `ASSETS_PATH/hybrid/{profile|artwork}/…` and return a `local:<path>` URL. Hydra's built-in `local:` custom protocol handler serves it to the renderer without HTTP. Drive upload is kept as a backup so a wiped local cache can still restore (via `appProperties: { hydraAsset: … }` on the Drive file).

### 6.5 Python RPC blocking main window

`await DownloadManager.startRPC(...)` in `main.ts` is called from `loadState()`. If Python isn't installed, the await never resolves and `createMainWindow()` never runs — the app appears not to start. Wrap in try/catch; treat RPC as optional.

### 6.6 Production builds don't need Python

`yarn build:win` bundles a pre-built `hydra-python-rpc.exe` (built with PyInstaller). Users don't need Python installed. The prebuilt binary must exist in `python_rpc/dist/` at build time; you can only build the Windows binary on Windows.

### 6.7 Windows toolchain quirks

- `HYDRA_PYTHON_BIN` must not contain quotes in the value.
- Windows App Execution Aliases intercept bare `python.exe` — always use a full path or an activated venv.
- `[Environment]::SetEnvironmentVariable(...)` requires a new terminal to take effect.
- node-gyp only works with Visual Studio **2017–2022** — VS 2026 is not recognized. Install "Desktop development with C++" workload on VS 2022 Build Tools.
- The Rust addon `hydra-native` requires `cargo` on PATH (install via rustup).

---

## 7. Post-Merge Verification Checklist

1. `yarn install` completes (Rust + C++ toolchain present).
2. `yarn typecheck` passes.
3. `yarn dev` — main window opens.
4. Sign in with a Hydra account.
5. **Settings → Cloud Storage** shows the connected Drive account (or lets you connect one).
6. Upload a static avatar (WebP) — profile sidebar **and** profile page render it, no broken image icon.
7. Upload an animated avatar (GIF) — animates on both sidebar and profile page.
8. Upload a profile banner — renders on profile page.
9. Upload custom artwork for a library game — thumbnail replaces default.
10. Cloud save round-trip: upload → delete local save → download → save file present.
11. Emulation save round-trip.
12. `%APPDATA%\hydralauncher\Assets\hybrid\` contains cached files.
13. Kill Python RPC (or run on a machine without Python) — app still opens; log doesn't spam.

---

## 8. Data Migration Notes

If a user upgrades from a version that stored `lh3.googleusercontent.com/d/<id>` URLs in LevelDB, those URLs will 429. The `extractDriveIdFromUrl` helper in `drive-storage.ts` recognizes both new (`/d/<fileId>`) and legacy (`?id=<fileId>`) formats so `removePreviousAsset()` can still delete them from Drive. Re-uploading the asset once replaces the stored URL with a fresh `local:` path.

To force-reset a broken URL without re-uploading, delete the specific key from LevelDB (e.g. `driveProfileImageUrl`) and log in again.

---

## 9. Debug Helpers

- `[hybrid override]` logs in `hydra-api.ts` — turn on when debugging interceptor coverage. Remove before release.
- Chrome DevTools **Network tab** in the Electron window: filter by `googleusercontent` to see if any hotlink is still being requested (should be zero after §6.4 fix).
- `PythonRPC.isUnavailable()` — quick check in DevTools console to confirm circuit breaker tripped.
- OAuth token issues: delete `driveAuth` from LevelDB and reconnect from settings.

---

## 10. Known Non-Fixes / Deferred

- `syncDownloadSourcesFromApi` crashes with `TypeError: profileSources is not iterable` when `/profile/download-sources` returns a 403 `feature/feature-not-enabled` JSON body. Non-fatal but noisy. Fix: guard the response with `Array.isArray(...)` before iterating.
- The `[hybrid override]` debug logs are still on `main` — remove once a release is cut.
- No automated tests cover the hybrid adapter. Manual verification via §7 is the only safety net.

---

## 11. Quick Reference: File Change Summary

```
NEW:
  src/main/services/hydra-hybrid-adapter.ts
  src/main/services/hybrid-axios.ts
  src/main/services/drive/drive-oauth.ts
  src/main/services/drive/drive-client.ts
  src/main/services/drive/drive-storage.ts
  src/renderer/src/pages/settings/settings-cloud-storage.tsx
  docs/HYBRID_SETUP.md
  docs/HYBRID_PATCH_GUIDE.md

MODIFIED:
  src/main/services/hydra-api.ts             (subscription bypass, adapter wiring, interceptors, currentUserId seed)
  src/main/services/python-rpc.ts            (circuit breaker)
  src/main/services/download/download-manager.ts  (skip polling when unavailable)
  src/main/main.ts                           (try/catch around startRPC)
  src/main/level/sublevels/keys.ts           (Drive key builders)
  src/renderer/src/context/settings/settings.context.tsx  (cloud_storage category)
  src/main/services/update-profile.ts        (hybridAxios for PUT)
  src/main/services/game-artwork-cloud.ts    (hybridAxios for PUT)
  src/main/services/emulation-cloud-saves.ts (hybridAxios for PUT)
  electron-builder.yml                       (publish.owner: spoofer8, updater points at fork)
```

---

## 12. Release Process

### 12.1 One-time repo setup (already done for `spoofer8/hydra`)

**Publish target** — in `electron-builder.yml`:
```yaml
publish:
  provider: github
  owner: spoofer8
  repo: hydra
```
This bakes an `app-update.yml` into every build telling electron-updater to poll `github.com/spoofer8/hydra/releases`. Auto-updates come from your fork, not upstream. **If you re-merge upstream and this key gets clobbered back to `hydralauncher`, updates start pulling from upstream and your users get a broken app.** Always re-check this file after a merge.

**Repo variables** (set via `gh variable set …`, one-time — reused by every release build):

| Variable | Value | Notes |
|---|---|---|
| `MAIN_VITE_API_URL` | `https://hydra-api-us-east-1.losbroxas.org` | Hydra's public API |
| `MAIN_VITE_AUTH_URL` | `https://auth.hydralauncher.gg` | Auth server |
| `MAIN_VITE_CHECKOUT_URL` | `https://checkout.hydralauncher.gg` | Subscription checkout (bypassed but must not be empty) |
| `EXTERNAL_RESOURCES_URL` | `https://assets.hydralauncher.gg` | Static assets (icons, banners) |
| `MAIN_VITE_WS_URL` | `wss://ws.hydralauncher.gg` | Achievement/friend WebSocket |
| `MAIN_VITE_NIMBUS_API_URL` | `https://hydra-api-us-east-1.losbroxas.org` | Only used by the vikingfile hoster; placeholder is fine |

GitHub rejects empty-string variable values, so `MAIN_VITE_NIMBUS_API_URL` is set to the API URL as a placeholder — its only consumer (`src/main/services/hosters/vikingfile.ts`) will just get 404s, no crash.

**Optional (Sentry):** `SENTRY_AUTH_TOKEN` (secret) and `SENTRY_DSN` (variable). Skipping them is fine — the build succeeds without source-map upload.

Verify current state anytime:
```bash
gh variable list --repo spoofer8/hydra
gh secret list --repo spoofer8/hydra
```

### 12.2 Version scheme

`package.json → version` uses:

```
<upstream-version>-hybrid.<counter>
```

Examples:
- `4.0.6-hybrid.1` — first fork release built on top of upstream 4.0.6
- `4.0.6-hybrid.2` — second fork build, still on upstream 4.0.6 base
- `4.0.7-hybrid.0` — after merging upstream 4.0.7, reset counter to 0

Why: distinguishes fork builds from official upstream releases in logs, GitHub tags, and the "About" dialog, without confusing semver ordering (a `-hybrid.N` suffix sorts *below* the plain upstream version, so a user manually installing upstream `4.0.6` would still see the fork as an "older" prerelease — which is intentional; we don't want fork builds to auto-update over official Hydra installs).

### 12.3 Cutting a release — commands

From a clean `main` (typecheck green, verification checklist §7 passed):

```bash
# 1. Bump version
# Edit package.json → "version": "4.0.7-hybrid.0"  (or next appropriate)

# 2. Commit
git add package.json
git commit -m "release: v4.0.7-hybrid.0"
git push origin main

# 3. Create + push release branch (triggers the Release workflow)
git checkout -b release/v4.0.7-hybrid.0
git push -u origin release/v4.0.7-hybrid.0
```

The workflow at `.github/workflows/release.yml` fires on any `release/**` push and:
- Builds Linux and Windows in parallel on GitHub-hosted runners
- Bundles the Python RPC binary via `cx_Freeze` (Windows runner has Python preinstalled — no local build needed)
- Publishes a **draft** release to `spoofer8/hydra/releases`

Watch progress:
```bash
gh run list --repo spoofer8/hydra --branch release/v4.0.7-hybrid.0
gh run watch --repo spoofer8/hydra <run-id>
```

Typical duration: 15–25 min.

### 12.4 After the workflow completes

1. Open https://github.com/spoofer8/hydra/releases — a **draft** release with the version tag will be there.
2. Verify assets uploaded:
   - `hydralauncher-<version>-setup.exe` (Windows installer)
   - `hydralauncher-<version>.AppImage` (Linux)
   - `latest.yml` / `latest-linux.yml` — **critical for auto-update**; if these are missing, updater clients won't see the release
3. Edit release notes (optional).
4. Click **Publish release**. Auto-updater picks it up on next check-in (usually within a few hours of an existing install).

### 12.5 Auto-update mechanics

- Every install polls `https://github.com/spoofer8/hydra/releases/latest` via `electron-updater`.
- `latest.yml` (from the release assets) is fetched, its `version` compared to the running version.
- If newer, the installer is downloaded in the background, and the app prompts the user to restart on next launch.
- Prereleases (anything with a `-` in the version like `-hybrid.1`) are **only** offered when `allowPrerelease: true` — check `electron-builder.yml` if you want fork builds served as stable. Currently the fork uses `-hybrid.N` and users are expected to enable prerelease updates. To serve fork builds as stable, drop the `-hybrid` suffix and just use e.g. `4.0.6.1` — but semver won't like it. Cleanest alternative: bump to a distinct minor line (e.g. `4.100.x`) so no upstream version ever collides.

### 12.6 Troubleshooting

**Workflow didn't fire after pushing the branch.**
- Confirm the branch prefix is exactly `release/` (with the slash). `releases/` or `Release/` won't match.
- Check the Actions tab is enabled at the fork level (Settings → Actions → General).

**Release workflow ran but no assets uploaded.**
- Check the `GITHUB_TOKEN` in the workflow has `contents: write`. It does by default on fork repos, but org policies can strip it. Add `permissions: { contents: write }` to the job if missing.

**Windows build fails at `winCodeSign` extraction with symlink error.**
- Not a workflow issue — that's the *local* Windows build. Enable Developer Mode (Settings → Privacy & security → For developers) or run as admin. GitHub runners are unaffected.

**Auto-update not triggering on existing installs.**
- Check `latest.yml` is present on the release. If missing, `electron-builder` didn't publish it — usually a `GITHUB_TOKEN` scope issue.
- Confirm the installed app's `resources/app-update.yml` has `owner: spoofer8`. If it still says `hydralauncher`, the build predates the publish-owner change (§12.1) and needs a fresh install to pick up the new updater target.
- Prereleases require `allowPrerelease: true` client-side — see §12.5.

**Wrong version bumped / need to re-release.**
- Delete the draft release: `gh release delete v<version> --repo spoofer8/hydra --yes`
- Delete the release branch: `git push origin --delete release/v<version>`
- Bump version again, push a new `release/vX.Y.Z-hybrid.N+1` branch. Never reuse a version tag — auto-updater caches ETags.

**Missing repo variables.**
- Symptom: build succeeds but the app boots pointing at `undefined` for API endpoints and every request 404s.
- Run `gh variable list --repo spoofer8/hydra` and compare against the table in §12.1.

---

## 13. Release Checklist (copy-paste)

```
[ ] main is clean, typecheck passes
[ ] §7 verification checklist passed on Windows dev build
[ ] electron-builder.yml → publish.owner is `spoofer8` (not `hydralauncher`)
[ ] package.json version bumped to X.Y.Z-hybrid.N
[ ] Commit + push to main
[ ] Create release/vX.Y.Z-hybrid.N branch, push it
[ ] Watch workflow: gh run watch --repo spoofer8/hydra <id>
[ ] Draft release created at github.com/spoofer8/hydra/releases
[ ] Assets present: <version>-setup.exe, .AppImage, latest.yml, latest-linux.yml
[ ] Edit release notes
[ ] Publish release
[ ] Test auto-update on one existing install
```

