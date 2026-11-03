import { useCallback, useEffect, useState } from "react";
import type {
  RecompilationInstallProgress,
  RecompilationInstallState,
} from "@types";

export interface RecompilationInstall {
  state: RecompilationInstallState | null;
  progress: RecompilationInstallProgress | null;
  isBusy: boolean;
  install: () => Promise<boolean>;
  uninstall: () => Promise<boolean>;
  play: () => Promise<boolean>;
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
    const result = await window.electron.playRecompilation({ objectId, slug });
    return result.ok;
  }, [objectId, slug]);

  const openFolder = useCallback(async () => {
    await window.electron.openRecompilationFolder({ objectId, slug });
  }, [objectId, slug]);

  const isBusy =
    Boolean(state?.isInstalling) ||
    progress?.phase === "downloading" ||
    progress?.phase === "extracting";

  return { state, progress, isBusy, install, uninstall, play, openFolder };
}
