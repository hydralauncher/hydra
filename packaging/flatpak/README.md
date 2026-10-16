# Building Hydra as a Flatpak

This directory contains a Flatpak packaging recipe for Hydra. It packages the
Linux application bundle produced by Hydra's existing Electron build; generated
application binaries stay out of the Git repository.

## Build locally on Fedora Atomic

Run the source build in a Toolbox so its compiler and Node dependencies stay
off the immutable host. The commands below assume the repository is checked out
at `~/src/hydra` on the host; Toolbox shares that directory.

### 1. Prepare the Toolbox

Create and enter a Toolbox:

```sh
toolbox create --container hydra-build
toolbox enter hydra-build
```

Install the project build tools inside the Toolbox. Hydra requires Node.js,
Yarn Classic, Rust, and a C++ toolchain; the native build obtains CMake and CTest
through vcpkg. `flatpak-builder` is needed to assemble the Flatpak.

```sh
sudo dnf install git nodejs npm gcc-c++ rust cargo flatpak-builder
npm install --global yarn@1.22.22
```

Use Node.js 22 or newer and Yarn 1.22.x. If the Fedora package version of
Node.js is older than 22, install Node.js 22 in the Toolbox before continuing.

### 2. Check out Hydra

If you have not cloned the repository yet:

```sh
mkdir -p ~/src
git clone https://github.com/hydralauncher/hydra.git ~/src/hydra
cd ~/src/hydra
```

To build a pull request instead of the default branch, check out that branch
before continuing.

### 3. Configure service URLs

The build script defaults to the Hydra API and authentication endpoints used by
the working build. Set these only if you need to override them. The checkout and
external asset endpoints are also required:

```sh
export MAIN_VITE_CHECKOUT_URL=https://checkout.hydralauncher.gg
export MAIN_VITE_EXTERNAL_RESOURCES_URL=https://assets.hydralauncher.gg
export RENDERER_VITE_EXTERNAL_RESOURCES_URL=https://assets.hydralauncher.gg
```

Keep `MAIN_VITE_LAUNCHER_SUBDOMAIN` unset to use the renderer bundled with the
build. Do not put private credentials in these variables.

### 4. Build the app and Flatpak

From the repository root, run:

```sh
bash packaging/flatpak/build.sh
```

The script installs the locked Yarn dependencies, builds Hydra's unpacked Linux
app, and creates a local Flatpak repository at
`packaging/flatpak/output/repo`.

If the Flatpak runtime or SDK is not installed, add Flathub in the Toolbox and
install the required runtime:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08
```

### 5. Install and launch

Run these commands on the Fedora Atomic host, using the same shared checkout:

```sh
flatpak install --user ~/src/hydra/packaging/flatpak/output/repo gg.hydralauncher.hydra
flatpak run gg.hydralauncher.hydra
```

The manifest grants network access for Hydra's online features, access to the
Downloads and `~/Games` folders, and device access for game controllers. It
does not expose host Steam folders. Inside Flatpak, UMU stores its own Proton
build, Steam Linux Runtime, and game prefixes in Hydra's private app data. This
lets Windows games run without the Steam client or a host Proton installation.
The first launch may download UMU-Proton and its runtime, so it needs network
access and may take longer.

### Troubleshooting

- If the app exits with `Cannot read properties of undefined (reading
  'includes')`, check the API endpoint variables and rebuild; their values are
  embedded in the app.
- The build script disables `rofiles-fuse` for Toolbox compatibility. If you
  invoke `flatpak-builder` directly, add `--disable-rofiles-fuse`.
- If you change service URLs, rebuild the app and Flatpak before reinstalling.
- Windows game files must be in `~/Games`, Downloads, or another directory
  explicitly selected through the file chooser.
