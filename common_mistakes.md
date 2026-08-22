# Common Hydra PR Mistakes and Guidelines

Reference checklist based on past pull requests, rejection reasons, and repository standards.

## Internationalization (i18n)

All user-facing text (labels, descriptions, placeholders, tooltips, dialogs) must be translated with i18next.
Desktop UI translations are nested under namespaces like `game_details` and `settings` in `src/locales/<lang>/translation.json`.
Big Picture translations live in `src/big-picture/src/locales/<lang>/translation.json` under the `exact` object using exact English strings as keys.
Never leave hardcoded English strings in JSX or TSX files.

## Desktop and Big Picture Parity

Any feature, setting, or configuration toggle added to Desktop UI must have an equivalent implementation in Big Picture mode, and vice versa.
Ensure controller focus navigation (`FocusItem`, `VerticalFocusGroup`, `HorizontalFocusGroup`) is properly wired in Big Picture components.

## TypeScript and Code Standards

Always use `T[]` array syntax (e.g. `string[]`, `ProtonVersion[]`) instead of `Array<T>`.
Use `logger` from `@main/services` for the main process and `@renderer/logger` for the renderer process. Do not use `console.log`, `console.error`, or `console.warn`.
Prefer named exports over default exports for services and helper modules.
Fix ESLint warnings with proper code structure instead of disabling rules.

## Git and PR Hygiene

Avoid committing temporary test scripts or unrelated configuration changes.
Always test with `npm run typecheck`, `npm run lint`, and `npm run format-check` before submitting a PR.
Use conventional commit messages (`feat: ...`, `fix: ...`) and link issue numbers (e.g., `Closes #2380`) in commit messages or PR descriptions.
