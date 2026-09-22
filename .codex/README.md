# Codex environment

`environments/environment.toml` contains inline setup commands for macOS
in `[setup]` and Windows PowerShell in `[setup.win32]`. Git must be on PATH.

The setup copies the main Git checkout's root `.env` to the new worktree
by locating its shared `.git` directory.
It preserves an existing destination and skips copying if the source is missing.
The file stays ignored by Git, and its contents are never logged.

Commit the `.codex` directory so the setup is available in new worktrees.
Keep a local `.env` in the main checkout on each machine.
