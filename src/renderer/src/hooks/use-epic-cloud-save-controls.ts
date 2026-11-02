import { useEffect, useRef, useState } from "react";
import type { LibraryGame } from "@types";
import { useEpicCloudSaves } from "./use-epic-managed";

export function useEpicCloudSaveControls(game: LibraryGame | null) {
  const cloud = useEpicCloudSaves(
    game?.objectId ?? null,
    game?.epicInstallation?.owner
  );
  const [failure, setFailure] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const settingsGeneration = useRef<number | null>(null);
  const current = useRef(game?.objectId);
  current.current = game?.objectId;
  useEffect(() => {
    setFailure(false);
    setSettingsBusy(false);
    settingsGeneration.current = null;
  }, [
    game?.objectId,
    game?.epicInstallation?.owner.userId,
    game?.epicInstallation?.owner.epicAccountId,
    game?.epicInstallation?.owner.environment,
  ]);

  const updateSettings = async (
    automaticSync: boolean,
    savePath?: string | null
  ) => {
    if (
      !game ||
      !cloud.state ||
      cloud.busy ||
      settingsGeneration.current !== null
    )
      return;
    const objectId = game.objectId;
    const generation = cloud.getGeneration();
    settingsGeneration.current = generation;
    setSettingsBusy(true);
    setFailure(false);
    try {
      const result = await window.electron.setEpicCloudSaveSettings?.(
        objectId,
        { automaticSync, savePath }
      );
      if (current.current !== objectId || generation !== cloud.getGeneration())
        return;
      if (!result?.ok) setFailure(true);
      await cloud.refresh();
    } catch {
      if (current.current === objectId && generation === cloud.getGeneration())
        setFailure(true);
    } finally {
      if (settingsGeneration.current === generation) {
        settingsGeneration.current = null;
        setSettingsBusy(false);
      }
    }
  };
  const choosePath = async () => {
    const objectId = game?.objectId;
    const generation = cloud.getGeneration();
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: cloud.state?.savePath ?? undefined,
    });
    if (
      current.current === objectId &&
      generation === cloud.getGeneration() &&
      result.filePaths[0]
    )
      await updateSettings(
        cloud.state?.automaticSync ?? true,
        result.filePaths[0]
      );
  };
  const sync = async () => {
    if (!game) return;
    const generation = cloud.getGeneration();
    setFailure(false);
    try {
      await cloud.run(
        () =>
          window.electron.syncEpicCloudSaves?.(game.objectId) ??
          Promise.reject(new Error("api-unavailable"))
      );
    } catch {
      if (
        current.current === game.objectId &&
        generation === cloud.getGeneration()
      )
        setFailure(true);
    }
  };
  const resolve = async (choice: "local" | "remote") => {
    if (!game || cloud.state?.status !== "conflict") return;
    const expectedRemoteManifest = cloud.state.remoteManifest;
    const expectedRemoteModifiedAt = cloud.state.remoteModifiedAt ?? null;
    const generation = cloud.getGeneration();
    setFailure(false);
    try {
      await cloud.run(
        () =>
          window.electron.resolveEpicCloudSaveConflict?.({
            epicObjectId: game.objectId,
            expectedRemoteManifest,
            expectedRemoteModifiedAt,
            choice,
          }) ?? Promise.reject(new Error("api-unavailable"))
      );
    } catch {
      if (
        current.current === game.objectId &&
        generation === cloud.getGeneration()
      )
        setFailure(true);
    }
  };
  const refresh = async () => {
    setFailure(false);
    await cloud.refresh();
  };
  return {
    ...cloud,
    refresh,
    busy: cloud.busy || settingsBusy,
    failure,
    updateSettings,
    choosePath,
    sync,
    resolve,
  };
}
