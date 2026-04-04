# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hydra is an Electron + React + TypeScript desktop gaming launcher. It uses a multi-process architecture (main, renderer, preload) built with electron-vite.

**Use yarn**, not npm — the project enforces this via the `engines` field in package.json.

## Commands

| Command                                        | Description                                     |
| ---------------------------------------------- | ----------------------------------------------- |
| `yarn dev`                                     | Start dev mode with hot reload                  |
| `yarn build`                                   | Typecheck + build all (main, preload, renderer) |
| `yarn build:win` / `build:mac` / `build:linux` | Platform-specific builds                        |
| `yarn lint`                                    | ESLint with auto-fix                            |
| `yarn format`                                  | Prettier format                                 |
| `yarn format-check`                            | Check formatting                                |
| `yarn typecheck`                               | Run both node and web typechecks                |
| `yarn typecheck:node`                          | Typecheck main/preload (`tsconfig.node.json`)   |
| `yarn typecheck:web`                           | Typecheck renderer (`tsconfig.web.json`)        |
| `yarn protoc`                                  | Compile protobuf definitions                    |

## Architecture

### Process Model

- **Main process** (`src/main/`) — Node.js backend: downloads, file I/O, LevelDB, system integration
- **Renderer process** (`src/renderer/src/`) — React UI with Redux Toolkit, react-router-dom, SCSS
- **Preload** (`src/preload/index.ts`) — IPC bridge exposing `window.electron` via `contextBridge`
- **Shared types** (`src/types/`) — Type definitions used across processes

### Path Aliases (from `electron.vite.config.ts`)

- `@main` → `src/main`
- `@renderer` → `src/renderer/src`
- `@locales` → `src/locales`
- `@shared` → `src/shared`
- `@resources` → `resources`

### IPC Event System

Events live in `src/main/events/` organized by domain (e.g., `auth/`, `catalogue/`, `library/`, `torrenting/`, `cloud-save/`). Each event is registered via `registerEvent()` from `register-event.ts`, which wraps `ipcMain.handle()` with auto-serialization. The preload script exposes these to the renderer through `window.electron`.

To add a new IPC event:

1. Create handler in `src/main/events/<domain>/`
2. Export it from `src/main/events/index.ts`
3. Expose it in `src/preload/index.ts`
4. Add the type to `src/renderer/src/declaration.d.ts`

### Services (`src/main/services/`)

Business logic singletons: `WindowManager`, `DownloadManager`, `Aria2`, `HydraApi`, `GoogleDriveService`, `Ludusavi`, `Logger`, etc. Imported via `@main/services`.

### Database

LevelDB via `classic-level`. Schema defined in `src/main/level/` with sublevels for each domain (games, downloads, themes, achievements, etc.). Types in `src/types/level.types.ts`.

### State Management (Renderer)

Redux Toolkit slices in `src/renderer/src/features/` (download, library, userPreferences, userDetails, window, toast, etc.). Custom hooks in `src/renderer/src/hooks/` wrap common operations.

### Internationalization

32 languages in `src/locales/[lang]/translation.json`. Uses i18next + react-i18next. All user-facing strings must go through `useTranslation("namespace")` — never hardcode English strings.

## Build & Quality

- After making changes, always run `yarn typecheck` and fix ALL errors (unused imports, undefined references, incorrect props) before reporting the task as complete.
- Never commit code that doesn't pass typecheck. No exceptions.
- If a build or typecheck fails, fix every error in one pass — don't fix one at a time across multiple rounds.

## Git Workflow

- When asked to "commit and push" or similar, just do it immediately — stage, commit, push. No explanations or summaries of what changed.
- Follow conventional commit format (enforced by commitlint).

## Implementation Approach

- **Read before writing**: Before implementing a feature, read the 3-5 most relevant existing files and grep for similar patterns already in the codebase. Match established conventions.
- **Confirm approach on ambiguous requests**: If the scope or location of a change is unclear, state the plan in 2-3 bullets and wait for confirmation before writing code.
- **Build real UI, not text**: When asked to implement a UI feature, always build actual interactive React components — never just display information as text output or explanations.

## Code Conventions

- **Logging**: Always use `logger` — never `console`. Main: `import { logger } from "@main/services"`. Renderer: `import { logger } from "@renderer/logger"`.
- **Array types**: Use `T[]` not `Array<T>`.
- **Async**: Prefer `async/await` over raw promises.
- **Exports**: Prefer named exports over default exports for utilities and services.
- **ESLint**: Fix issues properly before disabling rules. If disabling, add a comment explaining why. Unused vars prefixed with `_` are allowed.
- **Comments**: Focus on "why", not "what". Keep concise; avoid restating code.

## Formatting

- Double quotes (not single)
- Semicolons
- 2-space indent
- Trailing commas (es5)
- LF line endings
