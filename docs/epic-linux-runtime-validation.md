# Epic Linux runtime validation

The runtime smoke is independent of an Epic account. It executes the production
runtime, prefix, path mapping and supervised process modules, replacing only the
Electron application/database and Legendary account boundary with local ports.
It uses the pinned UMU zipapp, the private Python interpreter and a real Proton
installation. It does not replace UMU or Wine with test doubles.

From a Linux x64 checkout with the development runtimes and PE fixtures built:

```sh
node scripts/test-epic-linux-runtime.cjs \
  --python-runner /absolute/path/to/private/python-runner \
  --umu /absolute/path/to/umu-run \
  --data-dir /absolute/path/to/disposable-smoke-directory
```

Optional `--helper` and `--fixture` paths override the built development PE files.
Use Node 22.15 or newer (validated with 22.21.0). The smoke uses Node's normal
module loader with TypeScript transformation limited to real files inside this
checkout's `src` directory. Its Electron/database/account ports are objects,
not generated code. TypeScript and `string-argv` come only from this checkout's
installed dependencies; both are portable JavaScript, including when a Linux
Node executable runs the source from a Windows/NTFS mount. There is no dependency
directory or source-code override in the CLI. Other product builds still need
their platform's own native dependencies. The data directory contains only
synthetic smoke state and can be retained to inspect the runtime receipt. The
first execution downloads UMU-Proton and its Steam runtime into UMU's normal
per-user cache; later executions reuse that installation.

The smoke checks automatic UMU-Proton selection, an explicit Proton/custom prefix,
prefix generations, Unicode/spaces in paths, mapping a future output through its
existing parent's verified roundtrip, cached offline preparation, a real PE
launch, arguments, environment and working directory, empty private output buffers,
and absence of synthetic credentials in persisted runtime files. It also runs a
prerequisite returning the full Windows DWORD 3010 and the supervised system
reboot path. Cached offline mode does not promise that upstream UMU makes zero
metadata network attempts when executing the game.

The installation path is canonical and fixed in `STEAM_COMPAT_INSTALL_PATH`
through bootstrap, both path verbs, prerequisites and launch. Without this
context UMU infers different mounts from POSIX and Windows arguments: a mounted
volume can map to a drive such as `S:` that disappears before the reverse
lookup. The smoke also roundtrips its source fixture outside the prefix using
that fixture's captured installation context; this covers a Windows NTFS mount
when the checkout is accessed from WSL.

The Windows fixture is intentionally given synthetic authentication-like
arguments. Its temporary record is deleted before inspecting persisted files;
no Epic credentials are requested or written by this smoke.
The fixture does not emit credentials to stdout/stderr; the supervised-process
unit test separately emits synthetic secrets and proves they are discarded.

The implementation was exercised on Ubuntu in WSL2 with private Python 3.13.16,
UMU 1.4.4 and UMU-Proton-10.0-4. Separate Linux process tests exercise a detached
child after wrapper exit, natural tree completion, deadline cleanup after wrapper
success, incomplete process inspection, and spoof rejection for protected
systemd user infrastructure. These tests run in the normal user session.

A separate isolated run on rebased commit
`5a3734cfeaa24f5924e7cc1995787649596e4d83` used the real Linux native addon and
the production Epic tracker while a benign PE waited for ten seconds under UMU.
The native projection proved the invocation marker, canonical prefix, kernel
start ticks and canonical PE path; the tracker included that running fixture.
After natural PE and full process-tree exit, the tracker returned
`{ complete: true, paths: [] }`. The run exited zero. Its local evidence is
retained in `.cache/tracker-smoke-final.log`; only the explicit process identity
and path projection was logged, without raw argv or environment dumps.

Two upstream behaviors discovered by the real smoke are explicit implementation
decisions: UMU 1.4.4 treats `UMU_ZENITY=0` as truthy and skips the Python Proton
download, so the managed runtime clears that variable. Its `createprefix` command
intentionally exits 1 after initialization; Hydra instead runs the shipped
supervisor's benign `--probe` PE command and requires successful Windows execution
plus a valid prefix. Successful wrapper exit alone never permits a receipt:
attributed descendants must finish naturally within the tool deadline.

This smoke does not establish real Epic authentication, a commercial game
download, cloud account synchronization, DRM compatibility, or graphical game
rendering. Those require the separate authenticated product acceptance flow.

## Git and validation environment

The feature starts at the published #2906 head
`a4dfafb6621fc4e274158db59604dcdccc41a244` on
`codex/epic-linux-download-launch`. Its PR initially targets
`codex/epic-achievements-sync`; the original checkout's uncommitted changes were
not copied. Before publication, the feature was rebased onto the dependency's
updated published head `6d3a53f0a424dd01f27717b92f14ed836a7954d2`, preserving its
preview cancellation, shared caches and external-launcher checks. The branch was
subsequently rebased onto `719b1c363e9a3a02f182d9d9816ea7b18a1f4dd4`, preserving
the dependency's interrupted-save recovery and replacement-sync warnings. That
commit is now the Linux branch's dependency boundary; the sync-fix PR retains its
separate original boundary. The Linux validation copy uses an independent ext4
checkout of the same feature commit and its own dependencies and Rust targets.

The validation environment is Ubuntu WSL2 x86_64 with Node 22.21.0, Yarn 1.22.22,
Rust/MinGW, WSLg and Vulkan. Native addon loading is verified with Electron on
Linux and Windows. Wine supervisor acceptance separately exercises EXE/MSI,
full DWORD results, descendants, cancellation and real reboot effects
(rename/delete/RunOnce); it does not replace the UMU smoke above.

This host also produced nondeterministic V8 GC aborts in unchanged baseline
tests. Local checks use Node's `--single-threaded-gc` and bounded test concurrency;
the repository workflow and dependency versions remain unchanged. The full
checklist is `yarn test`, `yarn typecheck`, `yarn lint`, `yarn format-check`,
`npx commitlint --last --verbose`, `yarn check:ota-bridge`, native builds and
`yarn build:linux`. For the last command, a local Electron distribution of the
same version can avoid the configured download mirror:

```sh
yarn build:linux --config.electronDist=node_modules/electron/dist --publish never
```

The authenticated product cases in the SDD remain pending acceptance:
real Epic ownership/authentication and `requires_ot`, a real game download and
pause/restart/resume, prerequisite failure/retry, offline play, actual cloud
account restore/upload/conflicts and real graphical close on desktop, Big Picture
and Steam Deck/gamescope. WSLg/Vulkan and synthetic PE acceptance do not establish
Steam Deck acceptance. No merge is performed automatically.

Once #2906 is merged, reapply only this branch's feature commits, including when
the dependency was squash merged:

```sh
git fetch origin main
git rebase --onto origin/main 719b1c363e9a3a02f182d9d9816ea7b18a1f4dd4 codex/epic-linux-download-launch
git push --force-with-lease origin codex/epic-linux-download-launch
gh pr edit <linux-pr-number> --base main
```

Repeat affected checks before publishing that rebase. Never merge the feature PR
as part of this procedure.
