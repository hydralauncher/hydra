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
  org.freedesktop.Platform.Compat.i386//23.08 \
  org.freedesktop.Platform.GL32.default//23.08
```

## Status / known limitation

The i386 wall is cleared with this manifest — verified: the 32-bit runtime
mounts and `Cannot determine ld.so for i386-linux-gnu` no longer appears.

A **separate** blocker remains for game launch in the tightened sandbox:
pressure-vessel still fails to bring up its container with

```
bwrap: Can't find source path /proc/self/fd/NN: No such file or directory
```

The kernel allows nested user namespaces here, so this is pressure-vessel's
fd-passing to its bundled `bwrap` not surviving the Flatpak sandbox — a known
hard pressure-vessel-in-Flatpak interaction that permissions/env vars
(`--talk-name=org.freedesktop.Flatpak`, `PRESSURE_VESSEL_COPY_RUNTIME=1`) did
not resolve. Closing it likely needs routing the launch through
`flatpak-spawn --host`, or an upstream pressure-vessel fix.

Default `--filesystem=host` mode launches games today; tightened-mode Windows
games remain work in progress.
