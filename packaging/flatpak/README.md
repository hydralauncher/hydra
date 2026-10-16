# Building Hydra as a Flatpak

This directory contains a Flatpak packaging recipe for Hydra. It packages the
Linux application bundle produced by Hydra's existing Electron build; generated
application binaries stay out of the Git repository.

## Requirements

- Node.js and Yarn versions supported by the project
- Rust and the native build prerequisites listed in the project README
- `flatpak-builder` and the Flathub remote

## Build

From the repository root, run:

```sh
./packaging/flatpak/build.sh
```

The script installs the locked Yarn dependencies, runs Hydra's unpacked Linux
build, and creates a local Flatpak repository under
`packaging/flatpak/output/repo`.

To install the resulting build for the current user:

```sh
flatpak install --user packaging/flatpak/output/repo gg.hydralauncher.hydra
```

The manifest grants network access for Hydra's online features, access to the
game folders and compatibility tools users commonly need, and device access
for game controllers. The writable UMU home fix is proposed separately in
[#2927](https://github.com/hydralauncher/hydra/pull/2927).
