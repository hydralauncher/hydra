import { useCallback, useEffect, useState } from "react";
import type {
  RecompilationActionResult,
  RecompilationInstallProgress,
  RecompilationInstallState,
} from "@types";

export interface RecompilationInstall {
  state: RecompilationInstallState | null;
  progress: RecompilationInstallProgress | null;
  isBusy: boolean;
  isRunning: boolean;
  isLaunching: boolean;
  install: () => Promise<RecompilationActionResult>;
  uninstall: () => Promise<boolean>;
  play: () => Promise<boolean>;
  close: () => Promise<boolean>;
  openFolder: () => Promise<void>;
}

export function useRecompilationInstall(
  objectId: string,
  slug: string
): RecompilationInstall {
  const [state, setState] = useState<RecompilationInstallState | null>(null);
  const [progress, setProgress] = useState<RecompilationInstallProgress | null>(
    null
  );
  const [isRunning, setIsRunning] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  useEffect(() => {
    const gameId = `launchbox:${objectId}`;
    const update = (
      gamesRunning: { id: string; recompilationSlug?: string }[]
    ) => {
      setIsRunning(
        gamesRunning.some(
          (gameRunning) =>
            gameRunning.id === gameId && gameRunning.recompilationSlug === slug
        )
      );
    };

    setIsRunning(false);
    window.electron
      .getGamesRunning()
      .then(update)
      .catch(() => {});
    return window.electron.onGamesRunning(update);
  }, [objectId, slug]);

  const refresh = useCallback(async () => {
    const next = await window.electron.getRecompilationInstallState({
      objectId,
      slug,
    });
    setState(next);
  }, [objectId, slug]);

  useEffect(() => {
    setState(null);
    setProgress(null);
    void refresh();

    return window.electron.onRecompilationInstallProgress((payload) => {
      if (payload.slug !== slug) return;

      if (payload.phase === "done" || payload.phase === "error") {
        setProgress(payload.phase === "error" ? payload : null);
        void refresh();
        return;
      }

      setProgress(payload);
    });
  }, [refresh, slug]);

  const install = useCallback(async () => {
    setProgress({ slug, phase: "downloading", loaded: 0 });
    return window.electron.installRecompilation({ objectId, slug });
  }, [objectId, slug]);

  const uninstall = useCallback(async () => {
    const result = await window.electron.uninstallRecompilation({
      objectId,
      slug,
    });
    await refresh();
    return result.ok;
  }, [objectId, slug, refresh]);

  const play = useCallback(async () => {
    setIsLaunching(true);
    const result = await window.electron
      .playRecompilation({ objectId, slug })
      .finally(() => setIsLaunching(false));
    return result.ok || result.reason === "cloud_save_conflict";
  }, [objectId, slug]);

  const close = useCallback(async () => {
    const result = await window.electron.closeRecompilation({
      objectId,
      slug,
    });
    return result.ok;
  }, [objectId, slug]);

  const openFolder = useCallback(async () => {
    await window.electron.openRecompilationFolder({ objectId, slug });
  }, [objectId, slug]);

  const isBusy =
    Boolean(state?.isInstalling) ||
    progress?.phase === "downloading" ||
    progress?.phase === "extracting";

  return {
    state,
    progress,
    isBusy,
    isRunning,
    isLaunching,
    install,
    uninstall,
    play,
    close,
    openFolder,
  };
}
