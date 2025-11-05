# Building Hydra Launcher for macOS

Quick guide to build the DMG from scratch.

## What You Need

Install these first:

```bash
# Node.js (v20+)
brew install node

# Python 3.9+
brew install python@3.14

# Yarn
npm install --global yarn

# libtorrent (for Python)
brew install libtorrent-rasterbar

# aria2 (for HTTP downloads)
brew install aria2
```

## Build Steps

### 1. Install Python Dependencies

```bash
python3 -m pip install --user --break-system-packages -r requirements.txt
```

If `cx_Freeze` fails (it usually does), just install what you need:

```bash
python3 -m pip install --user --break-system-packages flask psutil Pillow aria2p libtorrent
```

### 2. Install Node Dependencies

```bash
yarn install
```

### 3. Build the DMG

```bash
yarn build:mac
```

That's it. The DMG will be in `dist/`.

## Running the App

Open the DMG and drag the app to Applications. Since it's not code-signed, you'll need to:

1. Right-click the app → **Open**
2. Or go to **System Settings** → **Privacy & Security** → **Open Anyway**

## Development Mode

```bash
yarn dev
```

Runs the app with hot-reload.

## Common Issues

**"ModuleNotFoundError: No module named 'flask'"**

The packaged app needs Flask and dependencies installed. Run:

```bash
python3 -m pip install --user --break-system-packages flask psutil Pillow aria2p libtorrent
```

Then restart the app.

**HTTP downloads failing**

Make sure aria2 is installed:

```bash
brew install aria2
which aria2c  # Should show /opt/homebrew/bin/aria2c
```

**Python not found**

The app checks these paths automatically:
- `/opt/homebrew/bin/python3` (Apple Silicon)
- `/usr/local/bin/python3` (Intel)
- `/usr/bin/python3` (System)

Install via Homebrew if it's missing:

```bash
brew install python@3.14
```

## How It Works

macOS builds use system Python directly (not a frozen binary). The Python scripts are bundled in the app, but you still need Flask and dependencies installed on your system.

The app automatically finds Python and aria2 from common Homebrew locations, so just make sure they're installed.

## Logs

If something breaks, check:

```
~/Library/Application Support/Hydra/logs/
```

- `pythonrpc.txt` - Python service logs
- `error.txt` - Error logs
- `info.txt` - Info logs

## Quick Check

Before building, verify everything:

```bash
python3 --version  # Should be 3.9+
python3 -c "import flask, psutil, libtorrent; print('✓ Python deps OK')"
which aria2c  # Should show aria2 path
node --version  # Should be v20+
yarn --version  # Should be v1.19.1+
```

If all checks pass, you're good to go.
