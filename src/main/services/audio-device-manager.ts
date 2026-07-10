import type { HydraAudioDevice } from "@types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NativeAddon } from "./native-addon";
import {
  PACTL_AUDIO_DEVICE_PREFIX,
  parsePactlAudioSinks,
  parseWpctlAudioSinks,
  WPCTL_AUDIO_DEVICE_PREFIX,
} from "./audio-device-manager-utils";

const execFileAsync = promisify(execFile);

async function commandExists(command: string) {
  try {
    await execFileAsync("sh", ["-c", 'command -v "$1"', "sh", command]);
    return true;
  } catch {
    return false;
  }
}

export class AudioDeviceManager {
  private static async getLinuxAudioDevices(): Promise<HydraAudioDevice[]> {
    if (await commandExists("pactl")) {
      const [{ stdout: sinksOutput }, defaultSinkName] = await Promise.all([
        execFileAsync("pactl", ["list", "sinks"]),
        this.getLinuxDefaultAudioDeviceId(),
      ]);

      return parsePactlAudioSinks(
        sinksOutput,
        defaultSinkName?.startsWith(PACTL_AUDIO_DEVICE_PREFIX)
          ? defaultSinkName.slice(PACTL_AUDIO_DEVICE_PREFIX.length)
          : null
      );
    }

    if (await commandExists("wpctl")) {
      const { stdout } = await execFileAsync("wpctl", ["status"]);
      return parseWpctlAudioSinks(stdout);
    }

    return [];
  }

  private static async getLinuxDefaultAudioDeviceId(): Promise<string | null> {
    if (await commandExists("pactl")) {
      const { stdout } = await execFileAsync("pactl", ["get-default-sink"]);
      const sinkName = stdout.trim();
      return sinkName ? `${PACTL_AUDIO_DEVICE_PREFIX}${sinkName}` : null;
    }

    if (await commandExists("wpctl")) {
      const devices = parseWpctlAudioSinks(
        (await execFileAsync("wpctl", ["status"])).stdout
      );
      return devices.find((device) => device.isDefault)?.id ?? null;
    }

    return null;
  }

  private static async setLinuxDefaultAudioDevice(
    id: string | null | undefined
  ) {
    if (!id) return false;

    try {
      if (id.startsWith(PACTL_AUDIO_DEVICE_PREFIX)) {
        await execFileAsync("pactl", [
          "set-default-sink",
          id.slice(PACTL_AUDIO_DEVICE_PREFIX.length),
        ]);
        return true;
      }

      if (id.startsWith(WPCTL_AUDIO_DEVICE_PREFIX)) {
        await execFileAsync("wpctl", [
          "set-default",
          id.slice(WPCTL_AUDIO_DEVICE_PREFIX.length),
        ]);
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }

  public static async getAudioDevices(): Promise<HydraAudioDevice[]> {
    if (process.platform === "linux") {
      return this.getLinuxAudioDevices();
    }

    if (process.platform !== "win32") return [];

    return NativeAddon.listAudioRenderDevices();
  }

  public static async getDefaultAudioDeviceId(): Promise<string | null> {
    if (process.platform === "linux") {
      return this.getLinuxDefaultAudioDeviceId();
    }

    if (process.platform !== "win32") return null;

    return NativeAddon.getDefaultAudioRenderDeviceId();
  }

  public static async setDefaultAudioDevice(id: string | null | undefined) {
    if (process.platform === "linux") {
      return this.setLinuxDefaultAudioDevice(id);
    }

    if (process.platform !== "win32" || !id) return false;

    return NativeAddon.setDefaultAudioRenderDeviceId(id);
  }
}
