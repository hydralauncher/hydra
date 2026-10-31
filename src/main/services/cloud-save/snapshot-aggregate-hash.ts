import type { BuildSnapshotAggregateHashInput } from "@types";

import { NativeAddon } from "../native-addon.js";
import { foldStateMetadataIntoHash } from "./state-metadata-hash.js";

/** Preserve the V1 hash exactly for snapshots without state metadata. */
export const buildCloudSaveAggregateHash = (
  input: BuildSnapshotAggregateHashInput
) => {
  const baseHash = NativeAddon.buildSnapshotAggregateHash(input);
  return foldStateMetadataIntoHash(baseHash, input.files);
};
