#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
rule_file="$script_dir/70-hydra-dualshock4.rules"
rule_target="/etc/udev/rules.d/70-hydra-dualshock4.rules"

if ! command -v pkexec >/dev/null 2>&1; then
  echo "pkexec is required to install the controller udev rule." >&2
  exit 1
fi

pkexec install -Dm644 "$rule_file" "$rule_target"
pkexec udevadm control --reload-rules
pkexec udevadm trigger --action=change --subsystem-match=hidraw

echo "Installed $rule_target. Reconnect the controller before launching a game."
