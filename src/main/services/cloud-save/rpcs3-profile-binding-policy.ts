import type { RestoreManifestFile } from "@types";

import { parseRpcs3SaveRawPath } from "./emulator-provider-identity.js";

export interface Rpcs3ProfileBinding {
  homeRoot: string;
  localProfileId: string;
  cloudProfileId: string;
}

export const listRpcs3CloudProfileIds = (
  files: Pick<RestoreManifestFile, "rawPath">[]
) =>
  [
    ...new Set(
      files
        .map((file) => parseRpcs3SaveRawPath(file.rawPath)?.profileId)
        .filter((profileId): profileId is string => !!profileId)
    ),
  ].sort();

export const isCurrentRpcs3ProfileBinding = (
  value: unknown,
  homeRoot: string,
  localProfileId: string
): value is Rpcs3ProfileBinding => {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<Rpcs3ProfileBinding>;
  return (
    binding.homeRoot === homeRoot &&
    binding.localProfileId === localProfileId &&
    typeof binding.cloudProfileId === "string" &&
    /^\d{8}$/.test(binding.cloudProfileId) &&
    binding.cloudProfileId !== "00000000"
  );
};

export const needsRpcs3ProfileBinding = (
  remoteProfiles: string[],
  binding: Rpcs3ProfileBinding | null
) =>
  remoteProfiles.length > 0 &&
  (!binding || !remoteProfiles.includes(binding.cloudProfileId));

export const canCreateInitialRpcs3ProfileBinding = (
  remoteProfiles: string[],
  localFiles: Pick<RestoreManifestFile, "rawPath">[],
  localProfileId: string
) =>
  remoteProfiles.length === 0 &&
  localFiles.some(
    (file) => parseRpcs3SaveRawPath(file.rawPath)?.profileId === localProfileId
  );
