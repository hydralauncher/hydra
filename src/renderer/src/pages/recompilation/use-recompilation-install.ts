import { useCallback, useEffect, useState } from "react";
import type {
  RecompilationInstallProgress,
  RecompilationInstallState,
} from "@types";

export interface RecompilationInstall {
  state: RecompilationInstallState | null;
  progress: RecompilationInstallProgress | null;
  isBusy: boolean;
  /** True while this port is open. */
  isRunning: boolean;
  /** True from a Play click until the port starts or fails to. */
  isLaunching: boolean;
  install: () => Promise<boolean>;
  uninstall: () => Promise<boolean>;
  play: () => Promise<boolean>;
  close: () => Promise<boolean>;
  openFolder: () => Promise<void>;
}

/**
 * Install state of one port on this PC, kept current through the install
 * progress events sent by the main process.
 */
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

  // A running port shows in the games running as its base game, tagged with
  // its slug.
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
    const result = await window.electron.installRecompilation({
      objectId,
      slug,
    });
    return result.ok;
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
    // Preparing the ROM and the cloud save takes a while before the port
    // shows as running; the Play buttons stay disabled until then.
    setIsLaunching(true);
    const result = await window.electron
      .playRecompilation({ objectId, slug })
      .finally(() => setIsLaunching(false));
    // A save conflict opens on the page instead of starting: not a failure.
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
