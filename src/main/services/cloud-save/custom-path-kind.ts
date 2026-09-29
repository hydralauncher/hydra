import type { RestoreManifestFile } from "@types";

const KNOWN_SAVE_FILE =
  /\.(?:srm|rtc|sav|mcd|mcr|ps2|raw|gcp|gci|mcs|psu|ppst|p2s|p2s\.backup|SAVESTAT(?:\.zst|\.gz)?|state(?:\d+|\.auto)?(?:\.png)?)$/i;

/** Old snapshots have no custom path kind. Infer only exact, known save files. */
export const inferCustomPathKind = (
  rawPath: string,
  files: Pick<RestoreManifestFile, "relativePath">[]
): "file" | "dir" => {
  if (files.length !== 1) return "dir";
  const leaf = rawPath.split("/").at(-1);
  return leaf && KNOWN_SAVE_FILE.test(leaf) && files[0].relativePath === leaf
    ? "file"
    : "dir";
};
