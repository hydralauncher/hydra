import type { EmulationSavePlatform } from "@types";

export const EMULATOR_CLOUD_SAVE_PREFIX = "<emulator><v1>";

export const emulatorCloudSaveRawPath = (platform: EmulationSavePlatform) =>
  `${EMULATOR_CLOUD_SAVE_PREFIX}<${platform}>`;

export const isEmulatorCloudSaveRawPath = (rawPath: string) =>
  rawPath === emulatorCloudSaveRawPath("ps1") ||
  rawPath === emulatorCloudSaveRawPath("ps2");

export const encodeEmulatorSaveIdentity = (
  saveIdentity: string,
  platform: EmulationSavePlatform
) =>
  `${Buffer.from(saveIdentity, "utf8").toString("base64url")}.${
    platform === "ps1" ? "mcs" : "psu"
  }`;

export const decodeEmulatorSaveIdentity = (
  relativePath: string,
  platform: EmulationSavePlatform
) => {
  const extension = platform === "ps1" ? ".mcs" : ".psu";
  if (!relativePath.endsWith(extension)) {
    throw new Error("cloud_save_emulator_artifact_invalid");
  }
  const encoded = relativePath.slice(0, -extension.length);
  const identity = Buffer.from(encoded, "base64url").toString("utf8");
  if (
    !identity ||
    Buffer.from(identity, "utf8").toString("base64url") !== encoded
  ) {
    throw new Error("cloud_save_emulator_identity_invalid");
  }
  return identity;
};
