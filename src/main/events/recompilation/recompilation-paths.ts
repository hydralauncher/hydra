import path from "node:path";

import type { RecompilationRef } from "@types";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const OBJECT_ID_PATTERN = /^\d{1,20}$/;

export const parseRecompilationRef = (
  ref: unknown
): RecompilationRef | null => {
  if (!ref || typeof ref !== "object") return null;
  const { objectId, slug } = ref as Record<string, unknown>;
  if (typeof objectId !== "string" || !OBJECT_ID_PATTERN.test(objectId)) {
    return null;
  }
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) return null;
  return { objectId, slug };
};

/** <downloads>/recompilations/<slug>. Updates go into the same folder. */
export const getRecompilationInstallDirectory = async (slug: string) =>
  path.join(await getDownloadsPath(), "recompilations", slug);
