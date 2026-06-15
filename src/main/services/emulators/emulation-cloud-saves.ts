import os from "node:os";

import axios from "axios";

import { HydraApi } from "@main/services/hydra-api";
import type {
  EmulationCloudSave,
  EmulationSaveEmulator,
  EmulationSavePlatform,
  EmulatorBinary,
} from "@types";

/*
 * Cloud emulation saves client (`/profile/emulation-saves`). Mirrors the
 * existing save-game cloud flow (`CloudSync.uploadSaveGame`): metadata calls go
 * through `HydraApi` (auth + subscription enforced), while the raw artifact
 * bytes are PUT/GET directly against the short-lived presigned URLs with
 * `axios`. Direct (non-barrel) service imports avoid a services/emulators cycle.
 *
 * Every call requires an active Hydra Cloud subscription.
 */

const SUB = { needsAuth: true, needsSubscription: true } as const;
const SAVE_KIND = "game_save" as const;

export const toEmulationSaveEmulator = (
  binary: EmulatorBinary
): EmulationSaveEmulator => {
  if (binary !== "duckstation" && binary !== "pcsx2") {
    throw new Error(`Emulator "${binary}" has no cloud emulation saves`);
  }
  return binary;
};

export interface UploadEmulationSaveInput {
  platform: EmulationSavePlatform;
  emulator: EmulationSaveEmulator;
  /** "launchbox" when the save matched a game; null (with objectId) otherwise. */
  shop: "launchbox" | null;
  objectId: string | null;
  /** Stable per-game slot id — the on-card folder name / save identifier. */
  saveIdentity: string;
  fileName: string; // must end in .psu (PS2) or .mcs (PS1)
  label: string;
  localLastModifiedAt: string; // ISO 8601
  buffer: Buffer;
}

/** Create a presigned upload, PUT the bytes, then commit — returns the save. */
export const uploadEmulationSave = async (
  input: UploadEmulationSaveInput
): Promise<EmulationCloudSave> => {
  const hasShop = Boolean(input.shop && input.objectId);
  const { id, uploadUrl } = await HydraApi.post<{
    id: string;
    uploadUrl: string;
  }>(
    "/profile/emulation-saves/upload-url",
    {
      platform: input.platform,
      emulator: input.emulator,
      saveKind: SAVE_KIND,
      ...(hasShop ? { shop: input.shop, objectId: input.objectId } : {}),
      saveIdentity: input.saveIdentity,
      artifactLengthInBytes: input.buffer.length,
    },
    SUB
  );

  await axios.put(uploadUrl, input.buffer, {
    headers: { "Content-Type": "application/octet-stream" },
  });

  return HydraApi.post<EmulationCloudSave>(
    `/profile/emulation-saves/${id}/commit`,
    {
      saveKind: SAVE_KIND,
      artifactLengthInBytes: input.buffer.length,
      fileName: input.fileName,
      hostname: os.hostname(),
      localLastModifiedAt: input.localLastModifiedAt,
      label: input.label,
    },
    SUB
  );
};

export const listEmulationSaves = async (
  platform: EmulationSavePlatform,
  emulator: EmulationSaveEmulator,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  const response = await HydraApi.get<EmulationCloudSave[]>(
    "/profile/emulation-saves",
    {
      platform,
      emulator,
      saveKind: SAVE_KIND,
      ...(objectId ? { shop: "launchbox", objectId } : {}),
    },
    SUB
  );
  return Array.isArray(response) ? response : [];
};

/** Resolve a download URL and fetch the raw save bytes. */
export const downloadEmulationSaveBytes = async (
  id: string
): Promise<Buffer> => {
  const { downloadUrl } = await HydraApi.post<{ downloadUrl: string }>(
    `/profile/emulation-saves/${id}/download-url`,
    undefined,
    SUB
  );
  const response = await axios.get<ArrayBuffer>(downloadUrl, {
    responseType: "arraybuffer",
  });
  return Buffer.from(response.data);
};

export const deleteEmulationSave = async (id: string): Promise<void> => {
  await HydraApi.delete(`/profile/emulation-saves/${id}`, SUB);
};

export const updateEmulationSave = async (
  id: string,
  body: { label?: string | null; metadata?: Record<string, unknown> | null }
): Promise<EmulationCloudSave> => {
  return HydraApi.put<EmulationCloudSave>(
    `/profile/emulation-saves/${id}`,
    body,
    SUB
  );
};
