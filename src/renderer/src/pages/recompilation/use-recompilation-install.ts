import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RecompilationActionResult,
  RecompilationInstallProgress,
  RecompilationInstallState,
  RecompilationPrepareProgress,
} from "@types";

export interface RecompilationInstall {
  state: RecompilationInstallState | null;
  progress: RecompilationInstallProgress | null;
  isBusy: boolean;
  isRunning: boolean;
  isLaunching: boolean;
  isPreparing: boolean;
  prepareFailed: boolean;
  install: (parentDirectory?: string) => Promise<RecompilationActionResult>;
  uninstall: () => Promise<boolean>;
  play: () => Promise<
    boolean | "already_running" | "pkg_job_running" | "rom_update_required"
  >;
  close: () => Promise<boolean>;
  openFolder: () => Promise<void>;
}

export const getInstallErrorKey = (reason?: string) => {
  if (reason === "running") return "install_running";
  if (reason === "no_executable") return "install_no_executable";
  if (reason === "install_folder_unwritable")
    return "install_folder_unwritable";
  return "install_failed";
};

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
  const [preparePhase, setPreparePhase] = useState<
    RecompilationPrepareProgress["phase"] | null
  >(null);
  const prepareErrorShown = useRef(false);
  const currentSlug = useRef(slug);
  currentSlug.current = slug;

  useEffect(() => {
    setPreparePhase(null);
    return window.electron.onRecompilationPrepareProgress((payload) => {
      if (payload.slug !== slug) return;
      if (payload.phase === "error") prepareErrorShown.current = true;
      setPreparePhase(payload.phase);
    });
  }, [slug]);

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

  const install = useCallback(
    async (parentDirectory?: string) => {
      setProgress({ slug, phase: "downloading", loaded: 0 });
      const result = await window.electron.installRecompilation(
        { objectId, slug },
        parentDirectory
      );
      // The page may show another port by now; its state must not change.
      if (currentSlug.current !== slug) return { ...result, preparing: false };
      if (!result.ok) {
        setProgress(null);
        await refresh();
      }
      // The reply can arrive before the "running" event, and the install
      // modal reads this when it opens.
      if (result.preparing) setPreparePhase("running");
      return result;
    },
    [objectId, slug, refresh]
  );

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
    prepareErrorShown.current = false;
    const result = await window.electron
      .playRecompilation({ objectId, slug })
      .finally(() => setIsLaunching(false));
    if (result.reason === "already_running") return "already_running";
    if (result.reason === "pkg_job_running") return "pkg_job_running";
    if (result.reason === "rom_update_required") return "rom_update_required";
    return (
      result.ok ||
      result.reason === "cloud_save_conflict" ||
      (result.reason === "rom_prepare_failed" && prepareErrorShown.current) ||
      result.reason === "running"
    );
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
    isPreparing:
      preparePhase === "running" ||
      (preparePhase === null && Boolean(state?.isPreparing)),
    prepareFailed: preparePhase === "error",
    install,
    uninstall,
    play,
    close,
    openFolder,
  };
}
