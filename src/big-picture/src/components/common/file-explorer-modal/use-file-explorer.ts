import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigationScreenActions } from "../../../hooks";
import type { DirectoryEntry } from "../../../helpers";
import {
  getParentPath,
  matchesFilters,
  normalizeFilters,
  type FileFilter,
} from "./utils";

const SKELETON_COUNT = 6;
function getErrorMessage(
  err: unknown,
  errorMessages: Record<string, string>,
  fallbackMessage: string
): string {
  const code =
    err instanceof Error && "code" in err
      ? (err as Record<string, unknown>).code
      : undefined;

  if (typeof code === "string") {
    return errorMessages[code] ?? fallbackMessage;
  }

  return fallbackMessage;
}

export interface FileExplorerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  title: string;
  initialPath?: string;
  filters?: FileFilter[];
  selectDirectory?: boolean;
}

function resolveStartPath(initialPath?: string): Promise<string> {
  if (initialPath) {
    return globalThis.window.electron
      .getPathInfo(initialPath)
      .then((info) =>
        info.exists && info.isFile
          ? (getParentPath(initialPath) ?? initialPath)
          : initialPath
      )
      .catch(() => initialPath);
  }

  return globalThis.window.electron
    .getUserPreferences()
    .then((prefs) => prefs?.downloadsPath)
    .catch(() => null)
    .then(
      (path) => path ?? globalThis.window.electron.getDefaultDownloadsPath()
    );
}

export function useFileExplorer({
  visible,
  onClose,
  onSelect,
  initialPath,
  filters,
  selectDirectory = false,
}: Readonly<FileExplorerModalProps>) {
  const { t } = useTranslation("big_picture");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const generatedId = useId();
  const fileListRegionId = `file-explorer-region-${generatedId.replaceAll(":", "")}`;
  const pathInputPlaceholder = t("file_explorer_path_placeholder");
  const drivesLabel = t("file_explorer_drives");
  const filterLabel = t("file_explorer_filters");
  const emptyFolderTitle = t("file_explorer_empty_folder");
  const emptyDirectoryChoiceTitle = t("file_explorer_empty_directory");
  const fileExplorerErrorFallback = t("file_explorer_error_default");
  const fileExplorerErrorMessages = useMemo(
    () => ({
      EACCES: t("file_explorer_error_eacces"),
      ENOENT: t("file_explorer_error_enoent"),
      ENOTDIR: t("file_explorer_error_enotdir"),
    }),
    [t]
  );
  const filterGroups = useMemo(() => normalizeFilters(filters), [filters]);

  const activeFilter = useMemo(() => {
    if (filterGroups.length === 0) return null;

    return (
      filterGroups.find((group) => group.id === activeFilterId) ??
      filterGroups.find((group) => group.mode === "extensions") ??
      filterGroups[0] ??
      null
    );
  }, [activeFilterId, filterGroups]);

  useEffect(() => {
    if (!visible) {
      setCurrentPath("");
      setEntries([]);
      setDrives([]);
      setIsLoading(false);
      setError(null);
      setActiveFilterId(null);
      return;
    }

    let cancelled = false;

    resolveStartPath(initialPath).then((path) => {
      if (!cancelled) setCurrentPath(path);
    });

    return () => {
      cancelled = true;
    };
  }, [visible, initialPath]);

  useEffect(() => {
    if (!visible) return;

    if (!currentPath) {
      setEntries([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result =
          await globalThis.window.electron.readDirectory(currentPath);

        if (!cancelled) setEntries(result);
      } catch (err) {
        if (!cancelled) {
          setError(
            getErrorMessage(
              err,
              fileExplorerErrorMessages,
              fileExplorerErrorFallback
            )
          );
          setEntries([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    visible,
    currentPath,
    fileExplorerErrorFallback,
    fileExplorerErrorMessages,
  ]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    const loadDrives = async () => {
      try {
        const result = await globalThis.window.electron.listDrives();
        if (!cancelled) setDrives(result);
      } catch {
        // Drives failed to load — the explorer can still use the current path.
      }
    };

    void loadDrives();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (filterGroups.length === 0) {
      setActiveFilterId(null);
      return;
    }

    const hasActiveFilter = filterGroups.some(
      (group) => group.id === activeFilterId
    );

    if (hasActiveFilter) return;

    const defaultFilter =
      filterGroups.find((group) => group.mode === "extensions") ??
      filterGroups[0];

    setActiveFilterId(defaultFilter?.id ?? null);
  }, [visible, filterGroups, activeFilterId]);

  const filteredEntries = useMemo(() => {
    if (drives.length > 0 && !currentPath) return [];
    return entries.filter((entry) =>
      matchesFilters(entry, activeFilter, selectDirectory)
    );
  }, [entries, activeFilter, drives, selectDirectory, currentPath]);

  const handleBPress = useCallback(() => {
    const parent = getParentPath(currentPath);
    if (parent) return setCurrentPath(parent);

    if (!currentPath) return onClose();

    if (drives.length > 0) {
      setCurrentPath("");
      return;
    }

    onClose();
  }, [currentPath, drives.length, onClose]);

  const handleBHold = useCallback(() => {
    onClose();
  }, [onClose]);

  useNavigationScreenActions(
    visible
      ? {
          press: { b: handleBPress },
          hold: { b: handleBHold },
        }
      : {}
  );

  const handleEntrySelect = useCallback(
    (entry: DirectoryEntry) => {
      if (entry.isDirectory) setCurrentPath(entry.path);
      else onSelect(entry.path);
    },
    [onSelect]
  );

  const handleSelectThisDirectory = useCallback(() => {
    onSelect(currentPath);
  }, [currentPath, onSelect]);

  const hasParent = Boolean(
    (currentPath && getParentPath(currentPath)) ||
      (currentPath && drives.length > 0)
  );

  const goToParent = useCallback(() => {
    const parent = getParentPath(currentPath);
    if (parent) return setCurrentPath(parent);

    if (drives.length > 0) setCurrentPath("");
  }, [currentPath, drives.length]);

  const showSelectThisDir = Boolean(selectDirectory && currentPath);
  const showDriveList = !currentPath && drives.length > 0;

  const navigateToDrive = useCallback((drive: string) => {
    setCurrentPath(drive);
  }, []);

  const selectFilter = useCallback((filterId: string) => {
    setActiveFilterId(filterId);
  }, []);

  const shouldShowFilterTabs = filterGroups.length > 1;

  const filterTabItems = useMemo(
    () =>
      filterGroups.map((group) => ({
        id: group.id,
        value: group.id,
        label: group.label,
      })),
    [filterGroups]
  );

  return {
    activeFilterId,
    currentPath,
    fileListRegionId,
    filterLabel,
    filterTabItems,
    isLoading,
    error,
    drives,
    filteredEntries,
    SKELETON_COUNT,
    PATH_INPUT_PLACEHOLDER: pathInputPlaceholder,
    DRIVES_LABEL: drivesLabel,
    emptyTitle: selectDirectory ? emptyDirectoryChoiceTitle : emptyFolderTitle,
    showSelectThisDir,
    showDriveList,
    shouldShowFilterTabs,
    hasParent,
    handleEntrySelect,
    handleSelectThisDirectory,
    goToParent,
    navigateToDrive,
    selectFilter,
  };
}
