# Testing the WebDAV Backup Feature

This guide explains how to compile and run Hydra from source so you can test the WebDAV backup integration.

---

## Prerequisites

| Tool    | Minimum version | Install               |
| ------- | --------------- | --------------------- |
| Git     | any recent      | https://git-scm.com   |
| Node.js | 18 LTS or newer | https://nodejs.org    |
| Yarn    | 1.19.1+         | `npm install -g yarn` |
| Python  | 3.10+           | https://python.org    |

> **Windows users:** also install the [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (required by some native Node.js modules).

---

## Step 1 — Clone the feature branch

```bash
git clone https://github.com/lucascanero/hydra.git
cd hydra
git checkout copilot/implement-webdav-backup-upload
```

---

## Step 2 — Install dependencies

```bash
yarn install
```

This also runs `postinstall`, which downloads the **Ludusavi** binary used for save-file detection.

---

## Step 3 — Run Hydra in development mode

```bash
yarn dev
```

Electron will start with hot-reload enabled. The app window opens automatically.

---

## Step 4 — Configure your WebDAV server in Hydra

1. Open **Settings** (gear icon in the sidebar)
2. Go to the **Integrations** tab
3. Scroll down to the **WebDAV** section
4. Fill in the fields:
   - **Server URL** → the URL of your WebDAV server (e.g. `https://dav.example.com`)
   - **Username** → your WebDAV username
   - **Password** → your WebDAV password
   - **Backup path** → remote directory for backups (default: `/hydra-backups`)
5. Click **Test connection** — you should see a success toast
6. Click **Save changes**

---

## Step 5 — Trigger a manual backup

1. Open any game in your library that has save files detectable by Ludusavi
2. Click the three-dot menu → **Game options**
3. In the **Hydra Cloud** section, click **New backup**

The backup will be uploaded to your WebDAV server under:

```
<backup-path>/<shop>-<objectId>/<hostname>_<timestamp>.tar
```

You can also call the IPC handler directly from the Electron DevTools console
(**View → Toggle Developer Tools** → Console tab):

```js
await window.electron.uploadSaveGameToWebDav("<objectId>", "steam", null);
```

---

## Step 6 — Test the auto-backup on game close

1. In **Game options → Hydra Cloud**, enable **Automatic cloud sync** for a game
2. Launch the game, play for a moment, then close it
3. Hydra will automatically bundle the save files and upload them to WebDAV

---

## Building a distributable package (optional)

If you want an installable binary instead of running from source:

| Platform | Command            | Output                                |
| -------- | ------------------ | ------------------------------------- |
| Windows  | `yarn build:win`   | `dist/` — `.exe` installer + portable |
| macOS    | `yarn build:mac`   | `dist/` — `.dmg`                      |
| Linux    | `yarn build:linux` | `dist/` — `.AppImage` / `.deb`        |

---

## Troubleshooting

| Symptom                         | Likely cause                   | Fix                                                                                          |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| "WebDAV connection failed"      | Wrong URL / server unreachable | Double-check URL; test with `curl -u user:pass -X PROPFIND <url>`                            |
| "WebDAV not configured" in logs | Settings not saved             | Click **Save changes** in the Integrations tab                                               |
| No backup file created          | Ludusavi found no saves        | Check Hydra logs; the game may have no detectable save path                                  |
| `yarn install` fails on Windows | Missing build tools            | Install [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| Electron won't start            | Node version too old           | Upgrade to Node.js 18 LTS or newer                                                           |

---

## Appendix — Running a local WebDAV server (if you don't have one)

If you don't have an existing WebDAV server, you can spin one up locally with Docker:

```bash
docker compose up -d   # uses docker-compose.yml in the repo root
```

This starts a WebDAV server at `http://localhost:8080` with:

| Field    | Value                   |
| -------- | ----------------------- |
| URL      | `http://localhost:8080` |
| Username | `hydra`                 |
| Password | `hydra123`              |

To stop it:

```bash
docker compose down        # keep data
docker compose down -v     # also remove stored backups
```
