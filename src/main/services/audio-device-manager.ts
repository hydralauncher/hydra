import type { HydraAudioDevice } from "@types";
import { NativeAddon } from "./native-addon";

export class AudioDeviceManager {
  public static async getAudioDevices(): Promise<HydraAudioDevice[]> {
    if (process.platform !== "win32") return [];

    return NativeAddon.listAudioRenderDevices();
  }

  public static async getDefaultAudioDeviceId(): Promise<string | null> {
    if (process.platform !== "win32") return null;

    return NativeAddon.getDefaultAudioRenderDeviceId();
  }

  public static async setDefaultAudioDevice(id: string | null | undefined) {
    if (process.platform !== "win32" || !id) return false;

    return NativeAddon.setDefaultAudioRenderDeviceId(id);
  }
}
