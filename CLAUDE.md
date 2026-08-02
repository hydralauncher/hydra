# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hydra Launcher is an open-source gaming platform (Electron + React + TypeScript) for managing a game library, cloud saves, achievements, and game downloads. It includes a Python subprocess for torrent operations (libtorrent) and a Rust N-API native addon for image processing.

## Commands

| Task | Command |
|---|---|
| Dev | `yarn dev` |
| Build | `yarn build` (runs typecheck + electron-vite build) |
| Typecheck | `yarn typecheck` (both node and web) |
| Typecheck main/preload | `yarn typecheck:node` |
| Typecheck renderer | `yarn typecheck:web` |
| Lint | `yarn lint` |
| Format | `yarn format` |
| Format check | `yarn format-check` |
| Test | `yarn test` (Node.js built-in test runner) |
| Run single test | `node --import ./scripts/register-ts-node.mjs --test "src/path/to/file.test.ts"` |
| Build native addon | `yarn build:native` (Rust N-API) |
| Build Python RPC | `yarn build:python-rpc` |

Package manager: **Yarn 1.x** (enforced via `.npmrc`).

## Architecture

### Multi-process Electron

- **Main** (`src/main/`): App lifecycle, IPC handlers, services, LevelDB database. Entry: `src/main/index.ts`.
- **Preload** (`src/preload/index.ts`): Single file bridging main↔renderer via `contextBridge`. Exposes `globalThis.electron`.
- **Renderer** (`src/renderer/src/`): React 18 app with Redux Toolkit + Zustand. Entry: `src/renderer/src/main.tsx`.
- **Big Picture** (`src/big-picture/`): Separate renderer entry for controller-friendly mode, built as a distinct Vite target.

### IPC Convention

IPC event handlers live in `src/main/events/` organized by domain (auth, catalogue, library, emulators, etc.). Each handler is registered via `registerEvent("eventName", handler)`. The preload file exposes these as `ipcRenderer.invoke(...)` calls.

### Database

LevelDB via `classic-level`. Sublevels defined in `src/main/level/`. Keys are constructed with `levelKeys.game(shop, objectId)` pattern. Data types in `src/types/level.types.ts`.

### Python RPC

Torrent downloading runs in a separate Python process (`python_rpc/main.py`) communicating over stdin/stdout JSON-RPC. Spawned by `src/main/services/python-rpc.ts`. Built binary at `hydra-python-rpc/`.

### Services

49 service modules in `src/main/services/`, re-exported from `src/main/services/index.ts`. Key services: `WindowManager`, `DownloadOrchestrator`, `GameFilesManager`, `HydraApi`, `CrossOver` (macOS Wine bottles).

## Path Aliases

| Alias | Target |
|---|---|
| `@main/*` | `src/main/*` |
| `@renderer/*` | `src/renderer/src/*` |
| `@types` | `src/types/index.ts` |
| `@locales` | `src/locales/index.ts` |
| `@shared` | `src/shared/index.ts` |

## Code Conventions

- **Logging**: Always use `logger` from `@main/services` (main) or `@renderer/logger` (renderer). Never `console`.
- **i18n**: All user-facing strings must use i18next `useTranslation` hook. Add keys to `src/locales/en/translation.json`.
- **Array types**: Use `T[]` not `Array<T>`.
- **Exports**: Prefer named exports.
- **Formatting**: Prettier with double quotes, 2-space indent, trailing commas ES5, semicolons.
- **ESLint**: Fix errors properly before disabling rules. `no-explicit-any` is warn; `no-unused-vars` is error (prefix with `_` to ignore).
- **Git hooks**: Husky — pre-commit runs Prettier, pre-push runs ESLint + typecheck. Commits must follow conventional commits (commitlint).

## TypeScript Config

Four tsconfig files form a composite project:
- `tsconfig.node.json` — main, preload, shared, types (ESNext modules)
- `tsconfig.web.json` — renderer, big-picture (JSX react-jsx)
- `tsconfig.test.json` — test files (extends node, noEmit)

## Environment Variables

Prefixed per electron-vite convention:
- `MAIN_VITE_*` — available in main process
- `RENDERER_VITE_*` — available in renderer

See `.env.example` for required variables.

## Multi-platform Notes

- **macOS**: CrossOver/Wine integration for Windows `.exe` games. Games are copied into bottle `drive_c/Program Files/` before launch.
- **Linux**: Umu (Proton) for Windows executables, Wine fallback. Bundles `umu-run`.
- **Windows**: Native execution. Bundles 7z.exe for extraction.
