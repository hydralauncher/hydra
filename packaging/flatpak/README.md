# Building Hydra as a Flatpak

This directory contains a local Flatpak packaging recipe for Hydra. It builds the Linux Electron app from source, applies the Flatpak-specific UMU patch, then packages the app. Generated binaries stay out of Git.

## Build locally on Fedora Atomic

Build the source inside a Fedora Toolbox; the Toolbox shares the checkout directory with the host.

### 1. Prepare the Toolbox

On the host, create and enter the Toolbox:

```sh
toolbox create --container hydra-build
toolbox enter hydra-build
```

Inside the Toolbox, install the build tools:

```sh
sudo dnf install git nodejs npm gcc-c++ rust cargo flatpak flatpak-builder
npm install --global yarn@1.22.22
```

Use Node.js 22 or newer and Yarn Classic 1.22.x. Hydra builds a small Windows helper for Epic integration; make sure the Rust target `x86_64-pc-windows-gnu` and MinGW linker are available. On Fedora, install them with `sudo dnf install rust-std-static-x86_64-pc-windows-gnu mingw64-gcc` if needed.

### 2. Check out the Flatpak branch

The packaging recipe is on the `flatpak-build` branch of this fork:

```sh
mkdir -p ~/src
git clone --branch flatpak-build https://github.com/Luis-Gustavo-Git-Hub/hydra.git ~/src/hydra
cd ~/src/hydra
```

### 3. Configure service URLs

The build script defaults the API and authentication URLs to the endpoints used by the working build. These checkout and asset endpoints are also required:

```sh
export MAIN_VITE_CHECKOUT_URL=https://checkout.hydralauncher.gg
export MAIN_VITE_EXTERNAL_RESOURCES_URL=https://assets.hydralauncher.gg
export RENDERER_VITE_EXTERNAL_RESOURCES_URL=https://assets.hydralauncher.gg
```

Leave `MAIN_VITE_LAUNCHER_SUBDOMAIN` unset to use the renderer bundled in the build. Do not put private credentials in these variables.

### 4. Install the Flatpak runtime and build

Inside the Toolbox, add Flathub and install the runtime and SDK required by the manifest before building:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08
```

From the repository root, run:

```sh
bash packaging/flatpak/build.sh
```

The script applies the Flatpak patch to the checked-out Hydra source, installs locked Yarn dependencies, builds the unpacked Linux app and creates the local Flatpak repository at `packaging/flatpak/output/repo`. The checkout is selected in step 2; the first build needs network access for source and dependency downloads.

### 5. Install and launch

Run these commands on the Fedora Atomic host from the same shared checkout:

```sh
flatpak install --user ~/src/hydra/packaging/flatpak/output/repo gg.hydralauncher.hydra
flatpak run gg.hydralauncher.hydra
```

The app needs network access for Hydra's online features. It can read Downloads and `~/Games` and access game controllers. It does not use host Steam directories: UMU downloads its own Proton and Steam Linux Runtime into Hydra's private app data on first Windows game launch. That first launch needs network access and may take longer.

### Troubleshooting

- If Hydra exits with `Cannot read properties of undefined (reading 'includes')`, check the service URL variables and rebuild; they are embedded in the app.
- If you run `flatpak-builder` manually, pass `--disable-rofiles-fuse` for Toolbox compatibility.
- If you change service URLs, rebuild the app and Flatpak before reinstalling.
- Keep game files in `~/Games`, Downloads, or another directory selected through the file chooser.
