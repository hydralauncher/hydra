import type { EmulatorSystem } from "@types";

import { EMULATOR_ICONS } from "@renderer/pages/settings/emulation/emulator-icons";
import { KNOWN_BINARY_LABELS } from "@renderer/pages/settings/emulation/known-binary-labels";
import ps1Art from "@renderer/assets/emulation/ps1.png";
import ps2Art from "@renderer/assets/emulation/ps2.png";
import ps3Art from "@renderer/assets/emulation/ps3.png";

export { EMULATOR_ICONS, KNOWN_BINARY_LABELS };

export const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

export const EMULATION_SYSTEMS: EmulatorSystem[] = ["ps1", "ps2", "ps3"];

export const EMULATION_SYSTEM_LABELS: Record<EmulatorSystem, string> = {
  ps1: "PlayStation 1",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
};

export const EMULATION_SYSTEM_ART: Record<EmulatorSystem, string> = {
  ps1: ps1Art,
  ps2: ps2Art,
  ps3: ps3Art,
};

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, unitIndex);

  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatRelative(ts: number | null): string {
  if (ts === null) return "Never";

  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "Never";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";

  return date.toLocaleString();
}

export function sanitizeFocusToken(value: string): string {
  return value.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}
