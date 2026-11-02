import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryGame } from "@types";

interface LinuxCompatibility {
  winePrefixPath: string | null;
  protonName: string | null;
  protonSource: "game" | "global" | "umu";
}

/** Reads the effective context without provisioning a runtime or a prefix. */
export function useGameLinuxCompatibility(
  game: LibraryGame | null,
  enabled = true
) {
  const shop = game?.shop;
  const objectId = game?.objectId;
  const scope = JSON.stringify([
    shop,
    objectId,
    game?.epicInstallation?.owner,
    game?.epicImportScope,
    game?.winePrefixPath,
    game?.protonPath,
  ]);
  const [result, setResult] = useState<{
    scope: string;
    value: LinuxCompatibility | null;
  } | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const available =
    enabled &&
    globalThis.window?.electron?.platform === "linux" &&
    typeof window.electron?.getGameLinuxCompatibility === "function";
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setResult(null);
    if (
      !available ||
      !shop ||
      !objectId ||
      typeof window.electron?.getGameLinuxCompatibility !== "function"
    ) {
      return;
    }
    try {
      const value = await window.electron.getGameLinuxCompatibility(
        shop,
        objectId
      );
      if (current === generation.current) setResult({ scope, value });
    } catch {
      if (current === generation.current) setResult(null);
    }
  }, [available, shop, objectId, scope]);

  useEffect(() => {
    void refresh();
    return invalidate;
  }, [refresh, invalidate]);

  return {
    compatibility: available && result?.scope === scope ? result.value : null,
    refresh,
  };
}
