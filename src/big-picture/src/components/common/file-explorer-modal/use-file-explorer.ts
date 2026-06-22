import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigationScreenActions } from "../../../hooks";
import { type DirectoryEntry } from "../../../helpers";
import {
  getParentPath,
  matchesFilters,
  normalizeFilters,
  type FileFilter,
} from "./utils";

const SKELETON_COUNT = 6;
const PATH_INPUT_PLACEHOLDER = "Select a location";
const DRIVES_LABEL = "Drives";
const EMPTY_FOLDER_TITLE = "This folder is empty";

export interface FileExplorerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  title: string;
  initialPath?: string;
  filters?: FileFilter[];
  selectDirectory?: boolean;
}

export function useFileExplorer({
  visible,
  onClose,
  onSelect,
  initialPath,
  filters,
  selectDirectory = false,
}: Readonly<FileExplorerModalProps>) {
  const [currentPath, setCurrentPath] = useState<string>(initialPath ?? "");
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInputValue, setPathInputValue] = useState(initialPath ?? "");
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const generatedId = useId();
  const fileListRegionId = `file-explorer-region-${generatedId.replaceAll(":", "")}`;

  useEffect(() => {
    if (!visible) {
      setError(null);
      return;
    }

    if (initialPath) {
      setCurrentPath(initialPath);
    }
  }, [visible, initialPath]);

  useEffect(() => {
    setPathInputValue(currentPath);
  }, [currentPath]);

  useEffect(() => {
    if (!visible) {
      setEntries([]);
      setDrives([]);
      return;
    }

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
            err instanceof Error ? err.message : "Failed to read directory"
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
  }, [visible, currentPath]);

  useEffect(() => {
    if (!visible || currentPath) {
      setDrives([]);
      return;
    }

    let cancelled = false;

    const loadDrives = async () => {
      try {
        const result = await globalThis.window.electron.listDrives();
        if (!cancelled) setDrives(result);
      } catch {
        if (!cancelled) setDrives(["/"]);
      }
    };

    void loadDrives();

    return () => {
      cancelled = true;
    };
  }, [visible, currentPath]);

  const allowedExtensions = useMemo(() => normalizeFilters(filters), [filters]);

  const filteredEntries = useMemo(() => {
    if (drives.length > 0 && !currentPath) return [];
    return entries.filter((entry) =>
      matchesFilters(entry, allowedExtensions, selectDirectory)
    );
  }, [entries, allowedExtensions, drives, selectDirectory, currentPath]);

  const handleBPress = useCallback(() => {
    if (!currentPath) return onClose();

    const parent = getParentPath(currentPath);
    if (!parent) return onClose();

    setCurrentPath(parent);
  }, [currentPath, onClose]);

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

  const handlePathEnter = useCallback(async () => {
    const target = pathInputValue.trim();
    if (!target) return;

    try {
      const info = await globalThis.window.electron.getPathInfo(target);
      if (info.exists && info.isDirectory) {
        setCurrentPath(target);
      } else setPathInputValue(currentPath);
    } catch {
      setPathInputValue(currentPath);
    }
  }, [pathInputValue, currentPath]);

  const handlePathInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handlePathEnter();
      }
    },
    [handlePathEnter]
  );

  const hasParent = Boolean(currentPath && getParentPath(currentPath));
  const goToParent = useCallback(() => {
    const parent = getParentPath(currentPath);
    if (parent) setCurrentPath(parent);
  }, [currentPath]);

  const showSelectThisDir = selectDirectory && currentPath;
  const showDriveList = !currentPath && drives.length > 0;

  const navigateToDrive = useCallback((drive: string) => {
    setCurrentPath(drive);
  }, []);

  return {
    currentPath,
    pathInputValue,
    setPathInputValue,
    pathInputRef,
    fileListRegionId,
    isLoading,
    error,
    drives,
    filteredEntries,
    SKELETON_COUNT,
    PATH_INPUT_PLACEHOLDER,
    DRIVES_LABEL,
    EMPTY_FOLDER_TITLE,
    showSelectThisDir,
    showDriveList,
    hasParent,
    handleEntrySelect,
    handleSelectThisDirectory,
    handlePathInputKeyDown,
    goToParent,
    navigateToDrive,
  };
}
