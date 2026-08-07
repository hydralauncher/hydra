import type { SnapshotVariant } from "@types";

type SnapshotVariantLike = SnapshotVariant & {
  steamId64?: string | null;
  concreteFolderId?: string | null;
};

export const areSnapshotVariantsEqual = (
  left: SnapshotVariantLike,
  right: SnapshotVariantLike
) => {
  if (left.variantId !== right.variantId || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "steam-account") {
    return left.steamId64 === right.steamId64;
  }
  if (left.kind === "opaque-folder") {
    return left.concreteFolderId === right.concreteFolderId;
  }
  return true;
};
