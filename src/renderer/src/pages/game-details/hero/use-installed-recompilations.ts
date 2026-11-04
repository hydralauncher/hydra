import { useCallback, useEffect, useRef } from "react";
import type { RecompilationSummary } from "@types";

import { useFeature } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { getGameRecompilations } from "../../recompilation/recompilations-api";

export interface InstalledRecompilation {
  slug: string;
  name: string;
  iconUrl: string | null;
  needsRom: boolean;
}

const REMEMBERED_KEY_PREFIX = "recompilationPlayChoice:";

export const RECOMPILATION_CHOICE_PREFIX = "recompilation:";

export const getRememberedRecompilation = (objectId: string) => {
  try {
    return window.localStorage.getItem(REMEMBERED_KEY_PREFIX + objectId);
  } catch {
    return null;
  }
};

export const setRememberedRecompilation = (
  objectId: string,
  slug: string | null
) => {
  try {
    if (slug)
      window.localStorage.setItem(REMEMBERED_KEY_PREFIX + objectId, slug);
    else window.localStorage.removeItem(REMEMBERED_KEY_PREFIX + objectId);
  } catch {
    // the choice is a convenience; launching still works without it
  }
};

export function useInstalledRecompilations(
  shop: string | undefined,
  objectId: string | undefined
) {
  const { isFeatureEnabled, Feature } = useFeature();
  const isEnabled =
    isFeatureEnabled(Feature.Recompilations) && shop === "launchbox";
  const summaries = useRef<RecompilationSummary[]>([]);

  useEffect(() => {
    summaries.current = [];
    if (!isEnabled || !objectId) return;

    let cancelled = false;
    getGameRecompilations(objectId)
      .then((items) => {
        if (!cancelled) summaries.current = Array.isArray(items) ? items : [];
      })
      .catch((error) => logger.error("Failed to load recompilations", error));

    return () => {
      cancelled = true;
    };
  }, [isEnabled, objectId]);

  return useCallback(async (): Promise<InstalledRecompilation[]> => {
    if (!isEnabled || !objectId) return [];

    const results = await Promise.all(
      summaries.current.map(async (summary) => {
        const ref = { objectId, slug: summary.slug };
        const [install, rom] = await Promise.all([
          window.electron.getRecompilationInstallState(ref).catch(() => null),
          window.electron.getRecompilationRomState(ref).catch(() => null),
        ]);
        if (!install?.installed) return null;

        return {
          slug: summary.slug,
          name: summary.name,
          iconUrl: summary.iconUrl ?? null,
          needsRom: rom?.handlesRom === true && !rom.romPath && !rom.isReady,
        };
      })
    );

    return results.filter(
      (item): item is InstalledRecompilation => item !== null
    );
  }, [isEnabled, objectId]);
}
