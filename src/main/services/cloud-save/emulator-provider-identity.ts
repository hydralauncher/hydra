import { createHash } from "node:crypto";

import type {
  CloudSaveFileIdentity,
  CloudSaveRule,
  GameShop,
  SnapshotVariant,
} from "@types";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const emulatorEnvironmentId = (
  baseEnvironmentId: string,
  providerKey: string | null
) => digest(JSON.stringify([baseEnvironmentId, providerKey]));

export const emulatorDefaultVariant = (
  shop: GameShop,
  objectId: string
): SnapshotVariant => ({
  variantId: digest(
    JSON.stringify({
      variantIdVersion: 1,
      shop,
      objectId,
      kind: "default",
    })
  ),
  kind: "default",
});

export const EMULATOR_SAVE_RAW_PATH_PREFIX = "<emulator>/";

export const rpcs3SaveRawPath = (titleId: string, profileId: string) =>
  `${EMULATOR_SAVE_RAW_PATH_PREFIX}rpcs3/${titleId}/${profileId}`;

// RPCS3 keeps savestates per title in its config directory, outside dev_hdd0
// and outside any PS3 user profile.
export const rpcs3SavestateRawPath = (titleId: string) =>
  `${EMULATOR_SAVE_RAW_PATH_PREFIX}rpcs3-state/${titleId}`;

export const retroArchSaveRawPath = (platform: string, romHash: string) =>
  `${EMULATOR_SAVE_RAW_PATH_PREFIX}retroarch/${platform}/${romHash}`;

export const retroArchGameRawPath = (platform: string) =>
  `${EMULATOR_SAVE_RAW_PATH_PREFIX}retroarch-v2/${platform}`;

export const parseRetroArchGameRawPath = (rawPath: string) => {
  const match = /^<emulator>\/retroarch-v2\/(nes|snes|n64|gb|gbc|gba)$/.exec(
    rawPath
  );
  return match ? { platform: match[1] } : null;
};

export const retroArchStateRelativePath = (stateId: string, image = false) =>
  `states/${stateId}.${image ? "png" : "state"}`;

export const parseRetroArchStateRelativePath = (relativePath: string) => {
  const match = /^states\/([a-f0-9]{64})\.(state|png)$/.exec(relativePath);
  return match ? { stateId: match[1], image: match[2] === "png" } : null;
};

export const isEmulatorSaveRawPath = (rawPath: string) =>
  rawPath.startsWith(EMULATOR_SAVE_RAW_PATH_PREFIX);

export const parseRpcs3SaveRawPath = (rawPath: string) => {
  const match = /^<emulator>\/rpcs3\/([A-Z]{4}\d{5})\/(\d{8})$/.exec(rawPath);
  return match ? { titleId: match[1], profileId: match[2] } : null;
};

export const parseRpcs3SavestateRawPath = (rawPath: string) => {
  const match = /^<emulator>\/rpcs3-state\/([A-Z]{4}\d{5})$/.exec(rawPath);
  return match ? { titleId: match[1] } : null;
};

export const parseRetroArchSaveRawPath = (rawPath: string) => {
  const match =
    /^<emulator>\/retroarch\/(nes|snes|n64|gb|gbc|gba)\/([A-F0-9]{8})$/.exec(
      rawPath
    );
  return match ? { platform: match[1], romHash: match[2] } : null;
};

export const safeRelativeSegments = (value: string): string[] | null => {
  if (!value || value.includes("\\") || value.startsWith("/")) return null;
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\0") ||
        segment.includes(":")
    )
  ) {
    return null;
  }
  return segments;
};

export const emulatorRestoreRule = (
  rawPath: string,
  preferredPath: string,
  kind: "dir" | "file"
): CloudSaveRule => ({
  ruleId: digest(JSON.stringify(["emulator", rawPath])),
  kind,
  rawPath,
  source: "emulator",
  tags: ["save"],
  when: [],
  preferredPath,
});

export const emulatorSaveFileKey = (file: CloudSaveFileIdentity) =>
  JSON.stringify([file.variantId, file.rawPath, file.relativePath]);
