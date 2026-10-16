# Hydra Flatpak: build and install

This recipe builds Hydra for Linux as a Flatpak from the flatpak-build branch. The resulting app uses the Freedesktop 25.08 runtime, so the installed app is not tied to Fedora, Debian, Arch, or the distribution used to build it. Flatpak is a Linux application format; this recipe does not produce a native Windows or macOS app.

The build script checks its prerequisites before doing work, applies the standalone UMU patch, builds Hydra and exports a local Flatpak repository. The first build downloads dependencies and the Flatpak runtime/SDK, so it needs network access. Generated output is written to packaging/flatpak/output/repo and is not committed.

## Supported build environments

The recipe is intended for Linux x86_64. It has been built successfully in Fedora Toolbox and Arch Linux Toolbox. Debian 13 (Trixie) is also a supported build environment; on Debian, use a normal system install or a Toolbox based on the Debian image, as not every Toolbx release offers Debian as a named distro. Other Linux distributions can build it if they provide the prerequisites below. The Flatpak app itself is portable across Linux distributions that support Flatpak and its required kernel features.

Builds require Linux, x86_64, and working unprivileged user namespaces for Flatpak Builder. The Windows helper included for Epic integration also needs the x86_64 MinGW compiler and Rust Windows target. The script gives a direct error when any required tool or target is missing.

## 1. Install build prerequisites

Use the package commands for your distribution. Install Rust stable through rustup and add the Windows target as described below. Keep Node.js at version 22 or newer and Yarn at 1.22.x (Yarn Classic).

### Fedora / Fedora Atomic

On Fedora Atomic, run the build inside a Toolbox so the host remains unchanged:

    toolbox create --container hydra-build
    toolbox enter hydra-build
    sudo dnf install git curl ca-certificates nodejs npm gcc gcc-c++ make python3 pkgconf-pkg-config flatpak flatpak-builder mingw64-gcc rustup

If your Fedora repositories package the Rust target separately, install it with sudo dnf install rust-std-static-x86_64-pc-windows-gnu. Otherwise rustup target add below downloads it.

### Debian 13 (Trixie) and newer

    sudo apt update
    sudo apt install git curl ca-certificates build-essential pkg-config python3 flatpak flatpak-builder gcc-mingw-w64-x86-64 xz-utils \
      libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libgtk-3-0t64 \
      libxcomposite1 libxdamage1 libxrandr2 libxkbcommon0 libasound2t64 libatspi2.0-0

Debian stable releases before Trixie may use the non-t64 names for some Electron libraries; install the equivalent packages available in that release. On older Debian releases also check that the kernel permits unprivileged user namespaces, which Bubblewrap/Flatpak Builder needs.

### Arch Linux

    sudo pacman -Syu --needed base-devel git curl nodejs npm rustup mingw-w64-gcc flatpak flatpak-builder \
      nspr nss atk at-spi2-core cups gtk3 libxcomposite libxdamage libxrandr libxkbcommon alsa-lib

After installing dependencies, use the same Rust and JavaScript setup on each distribution:

    rustup default stable
    rustup target add x86_64-pc-windows-gnu
    npm install --global yarn@1.22.22

On Debian, install Node.js 22+ if the distribution package is older. The official Node.js Linux archive is available for x86_64 and arm64 at https://nodejs.org/en/download. For example, unpack the matching archive under $HOME/.local/opt/node and add its bin directory to PATH before installing Yarn and running the build. Check the archive checksum against the official SHASUMS256.txt file.

Verify versions and the cross compiler before building:

    node --version                 # v22 or newer
    yarn --version                 # 1.22.x
    rustc --version
    x86_64-w64-mingw32-gcc --version

## 2. Get the source

Clone the branch containing the packaging recipe:

    mkdir -p "$HOME/src"
    git clone --branch flatpak-build https://github.com/Luis-Gustavo-Git-Hub/hydra.git "$HOME/src/hydra"
    cd "$HOME/src/hydra"

If you already have a clone, switch to and update that branch:

    git fetch origin
    git switch flatpak-build
    git pull --ff-only origin flatpak-build

## 3. Set the service URLs

The API and authentication URLs have defaults in the build script. Set the checkout and asset URLs used by the working build:

    export MAIN_VITE_CHECKOUT_URL=https://checkout.hydralauncher.gg
    export MAIN_VITE_EXTERNAL_RESOURCES_URL=https://assets.hydralauncher.gg
    export RENDERER_VITE_EXTERNAL_RESOURCES_URL=https://assets.hydralauncher.gg

These values are embedded in the application at build time. They are public service addresses, not credentials. Leave MAIN_VITE_LAUNCHER_SUBDOMAIN unset to bundle and use the renderer built from this checkout.

## 4. Install the Flatpak SDK and build

Add Flathub and install the runtime and SDK version used by the manifest:

    flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
    flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08

From the repository root, build:

    bash packaging/flatpak/build.sh

The script verifies Node, Yarn, Rust, MinGW, Flatpak Builder, and compiler tools; installs locked Yarn dependencies; builds the Linux Electron app; and exports packaging/flatpak/output/repo. It can be rerun after updating the source. The script cleans its generated Flatpak output before rebuilding.

## 5. Install and launch

Install the local build from the repository directory, then launch it:

    flatpak install --user packaging/flatpak/output/repo gg.hydralauncher.hydra
    flatpak run gg.hydralauncher.hydra

Hydra's online features need network access. The app can access Downloads, ~/Games, and game controllers. Windows games run inside the Flatpak: the standalone UMU integration downloads its own Proton and Steam Linux Runtime to Hydra's private application data on first launch. No Steam installation or host Steam directory is required. The first game launch needs network access and may take longer while those components are downloaded.

## Troubleshooting

- **Missing build tool or target:** rerun the matching package command above, then check node, yarn, rustc, x86_64-w64-mingw32-gcc, flatpak, and flatpak-builder are on PATH. Run rustup target add x86_64-pc-windows-gnu if the script reports that target missing.
- **Electron reports missing shared libraries during the build:** install the Electron runtime library packages listed for Debian or Arch above. Fedora Toolbox images normally already include these GUI libraries; otherwise install their Fedora equivalents (nspr, nss, atk, at-spi2-core, cups-libs, gtk3, libXcomposite, libXdamage, libXrandr, libxkbcommon, and alsa-lib).
- **Flatpak Builder cannot create a sandbox or reports user namespace errors:** confirm that your kernel and container configuration allow unprivileged user namespaces and that Bubblewrap is installed. Debian documents/ships this differently across releases; do not run the build as root to work around it.
- **Hydra has an empty API, login, checkout, or asset configuration:** confirm the three exported URLs in step 3 and rebuild. The API/auth defaults are embedded by build.sh.
- **Toolbox build reports an issue with rofiles-fuse:** the build recipe already passes --disable-rofiles-fuse to Flatpak Builder for container compatibility.
- **The app cannot access a game directory:** choose the directory through Hydra's file picker or place games in ~/Games/Downloads, which the manifest exposes to the app.

## What has been verified

The full packaging/flatpak/build.sh recipe has been run in Fedora Toolbox, Arch Linux Toolbox, and Debian 13 Toolbox on x86_64. The Debian and Arch runs used the package sets above, Node.js 22, Yarn Classic 1.22, Rust stable with the Windows target, and the Freedesktop 25.08 SDK. This verifies reproducible builds in these environments; GPU drivers, controller access, game performance, and individual Proton titles still depend on the host hardware and setup.
