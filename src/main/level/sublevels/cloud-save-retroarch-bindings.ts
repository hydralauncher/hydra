import { db } from "../level";
import { levelKeys } from "./keys";

export interface RetroArchStateBinding {
  id: string;
  path: string;
  slot: string;
  hash: string;
}

export interface RetroArchBindingRecord {
  version: 1;
  activeRomPath: string | null;
  selectedBatterySignature?: string;
  selectedLegacyBatteryRawPath?: string;
  batterySources?: Array<{
    romPath: string;
    files: Array<{
      relativePath: string;
      path: string;
      hash: string;
      lastModifiedAt: string;
    }>;
    signature: string;
  }>;
  states: RetroArchStateBinding[];
}

export const cloudSaveRetroArchBindingsSublevel = db.sublevel<
  string,
  RetroArchBindingRecord
>(levelKeys.cloudSaveRetroArchBindings, { valueEncoding: "json" });
