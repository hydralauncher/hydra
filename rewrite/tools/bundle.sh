#!/bin/zsh
# Build "Hydra (Rewrite).app" so the dev build launches through LaunchServices
# like a shipped Mac app. Usage: rewrite/tools/bundle.sh
#
# Not a release build: FFmpeg/dav1d are still linked from Homebrew (see
# docs/parity-plan.md, "Packaging"). Ad-hoc signed only.
set -e
cd "$(dirname "$0")/.."
cargo build --release -p hydra-desktop
APP="target/Hydra (Rewrite).app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp target/release/hydra "$APP/Contents/MacOS/"
if [[ -f ../build/icon.icns ]]; then
  cp ../build/icon.icns "$APP/Contents/Resources/icon.icns"
fi
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Hydra (Rewrite)</string>
  <key>CFBundleIdentifier</key><string>gg.hydralauncher.hydra.rewrite-dev</string>
  <key>CFBundleExecutable</key><string>hydra</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "$APP"
