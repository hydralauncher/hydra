import type { RestoreManifestFile } from "@types";

import { parseRpcs3SaveRawPath } from "./emulator-provider-identity.js";

export interface Rpcs3ProfileBinding {
  configRoot: string;
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
  configRoot: string,
  homeRoot: string,
  localProfileId: string
): value is Rpcs3ProfileBinding => {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<Rpcs3ProfileBinding>;
  return (
    binding.configRoot === configRoot &&
    binding.homeRoot === homeRoot &&
    binding.localProfileId === localProfileId &&
    typeof binding.cloudProfileId === "string" &&
    /^\d{8}$/.test(binding.cloudProfileId) &&
    binding.cloudProfileId !== "00000000"
  );
};

export const chooseRpcs3CloudProfileId = (
  remoteProfiles: string[],
  binding: Rpcs3ProfileBinding | null,
  localProfileId: string
): string | null => {
  if (remoteProfiles.length === 0) {
    return binding?.cloudProfileId ?? localProfileId;
  }
  if (remoteProfiles.length === 1) return remoteProfiles[0];
  if (binding && remoteProfiles.includes(binding.cloudProfileId)) {
    return binding.cloudProfileId;
  }
  return null;
};
