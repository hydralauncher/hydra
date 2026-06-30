# Flatpak (custom manifest)

This directory holds a hand-authored [`flatpak-builder`](https://docs.flatpak.org/en/latest/flatpak-builder.html)
manifest for Hydra. It exists alongside electron-builder's own `flatpak` target
because electron-builder **cannot declare runtime extensions**, and Proton needs
the 32-bit runtime inside the sandbox.

## Why this exists

Hydra launches Windows games through umu/Proton. Proton's `pressure-vessel`
runtime runs 32-bit helpers (e.g. `capsule-capture-libs`) while assembling its
container. In the default `--filesystem=host` configuration those helpers find
the host's i386 loader and libraries, so games launch.

In the **tightened** configuration (`--nofilesystem=host --filesystem=xdg-download`)
there is no host access, and the freedesktop 23.08 runtime alone has no 32-bit
ELF loader — so the launch dies with:

```
Cannot determine ld.so for i386-linux-gnu: Failed to execute child process
```

This manifest fixes that by declaring the `org.freedesktop.Platform.Compat.i386`
and `GL32` extensions (via `add-extensions`), which mount a full 32-bit runtime
at `/app/lib/i386-linux-gnu`. It also bundles the Proton permission set
(`--allow=multiarch|devel|per-app-dev-shm`, `--device=all`,
`--talk-name=org.freedesktop.Flatpak`).

## Building

```sh
npm run build:flatpak
```

That runs `electron-builder --linux dir` to produce `dist/linux-unpacked`, then
`scripts/build-flatpak.cjs`, which calls `flatpak-builder` with
`flatpak/gg.hydralauncher.hydra.yaml` and exports `dist/hydralauncher-<version>.flatpak`.

The build host needs `flatpak` + `flatpak-builder` and the Flathub remote. The
runtime extensions are pulled automatically; to run the result the user's
machine must have them installed (Compat.i386 auto-downloads; GL32 is pulled by
`enable-if=active-gl-driver`):

```sh
flatpak install -y flathub \
  org.freedesktop.Platform.Compat.i386//25.08 \
  org.freedesktop.Platform.GL32.default//25.08
```

## How this matches the Steam / Lutris Flatpaks

Both the Steam and Lutris Flatpaks run Proton in-sandbox with the same core
permission set used here (`devel;multiarch;per-app-dev-shm`, `device=all`).
Two further details were taken from them:

- **`--talk-name=org.freedesktop.Flatpak`** (Lutris ships this). It lets
  pressure-vessel ask the Flatpak portal to build its container as a _sub-sandbox_
  (`steam-runtime-launch-client` → `org.freedesktop.portal.Flatpak`) instead of a
  raw nested `bwrap`. With it, the launch reaches the portal spawn — verified:
  `Connected to flatpak-portal: org.freedesktop.portal.Flatpak`.
- **Runtime `25.08`** — the version the Steam Flatpak ships on, vs the 23.08 the
  rest of Hydra used.

## Tightened-sandbox game launch

With this manifest, launching Windows games via Proton works **both** in the
default `--filesystem=host` mode and in a tightened sandbox — verified
end-to-end (game window opens) with:

```sh
flatpak override --user --nofilesystem=host \
  --filesystem=xdg-download \
  --filesystem=xdg-data/Steam:create \
  --filesystem=xdg-data/umu:create \
  gg.hydralauncher.hydra
# + --filesystem=<library> if games are kept outside xdg-download
```

`--filesystem=host` is **not** required. The floor is: the game library, the umu
runtime (`xdg-data/umu`) and the Proton build (`xdg-data/Steam`). `pressure-vessel`
runs in Hydra's process and opens fds to all of those before handing them to the
Flatpak portal to build the container; if a path is outside the granted scope the
`open()` fails and the portal's bwrap reports
`Can't find source path /proc/self/fd/NN`. (`--filesystem=home`, the scope the
Lutris Flatpak uses, also works and is simpler but broader.)

Granting **only** `xdg-download` is enough to browse and download games but not to
launch Windows ones, because pressure-vessel can't reach the umu/Proton dirs.

### What it took

- **i386 runtime** (`Compat.i386` + `GL32` extensions) — without it the launch
  died at `Cannot determine ld.so for i386-linux-gnu` (no 32-bit loader in the
  sandbox). electron-builder's flatpak target can't declare these, which is the
  whole reason for this manifest.
- **`--talk-name=org.freedesktop.Flatpak`** — pressure-vessel builds its container
  as a Flatpak portal _sub-sandbox_ (`steam-runtime-launch-client` →
  `org.freedesktop.portal.Flatpak`) rather than a raw nested bwrap.
- **Runtime `25.08`** — matches the Steam Flatpak.
