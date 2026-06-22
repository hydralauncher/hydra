import "./styles.scss";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CheckCircle, FolderIcon, FolderOpen } from "@phosphor-icons/react";
import { Modal } from "../modal";
import { VerticalFocusGroup } from "../vertical-focus-group";
import { FocusItem } from "../focus-item";
import { EmptyState } from "../empty-state";
import { Skeleton } from "../skeleton";
import { useNavigationScreenActions } from "../../../hooks";
import { getEntryIcon, type DirectoryEntry } from "../../../helpers";

interface FileFilter {
  name: string;
  extensions: string[];
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

function getParentPath(path: string): string | null {
  if (!path) return null;

  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");

  if (normalized === "/") return null;
  if (/^[A-Za-z]:$/i.test(normalized)) return null;

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return null;

  const parent = normalized.substring(0, lastSlash) || "/";

  if (/^[A-Za-z]:$/i.test(parent)) return parent + "/";

  return parent;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function matchesFilters(
  entry: DirectoryEntry,
  filters?: FileFilter[],
  directoryOnly?: boolean
): boolean {
  if (directoryOnly && !entry.isDirectory) return false;
  if (entry.isDirectory) return true;
  if (!filters || filters.length === 0) return true;

  const allExtensions = filters.flatMap((f) => f.extensions);
  if (allExtensions.includes("*")) return true;

  return allExtensions.includes(entry.extension);
}

const SKELETON_COUNT = 6;

export function FileExplorerModal({
  visible,
  onClose,
  onSelect,
  title,
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
        if (!cancelled) {
          setEntries(result);
        }
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

  const filteredEntries = useMemo(() => {
    if (drives.length > 0 && !currentPath) {
      return [];
    }
    return entries.filter((entry) =>
      matchesFilters(entry, filters, selectDirectory)
    );
  }, [entries, filters, drives, selectDirectory, currentPath]);

  const handleBPress = useCallback(() => {
    if (!currentPath) {
      onClose();
      return;
    }

    const parent = getParentPath(currentPath);
    if (parent) {
      setCurrentPath(parent);
    } else {
      onClose();
    }
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
      if (entry.isDirectory) {
        setCurrentPath(entry.path);
      } else {
        onSelect(entry.path);
      }
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
      } else {
        setPathInputValue(currentPath);
      }
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
  const handleModalBack = useCallback(() => {
    const parent = getParentPath(currentPath);
    if (parent) setCurrentPath(parent);
  }, [currentPath]);

  const showSelectThisDir = selectDirectory && currentPath;
  const showDriveList = !currentPath && drives.length > 0;

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      onBack={hasParent ? handleModalBack : undefined}
      title={title}
      closeOnB={false}
      closeOnEscape={false}
    >
      <div className="file-explorer">
        {isLoading && (
          <div className="file-explorer__list">
            <div className="file-explorer__skeleton-group">
              {Array.from({ length: SKELETON_COUNT }, (_, i) => (
                <Skeleton key={i} className="file-explorer__skeleton" />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="file-explorer__list">
            <div className="file-explorer__status file-explorer__status--error">
              {error}
            </div>
          </div>
        )}

        {!isLoading && !error && (
          <VerticalFocusGroup
            regionId={fileListRegionId}
            className="file-explorer__list"
          >
            <div className="file-explorer__path-input-wrapper">
              <FocusItem
                stealFocusOnAppear
                actions={{ primary: () => pathInputRef.current?.focus() }}
              >
                <input
                  ref={pathInputRef}
                  className="file-explorer__path-input"
                  type="text"
                  placeholder={currentPath || "Select a location"}
                  value={pathInputValue}
                  onChange={(e) => setPathInputValue(e.target.value)}
                  onKeyDown={handlePathInputKeyDown}
                />
              </FocusItem>
              <FolderOpen
                size={24}
                weight="fill"
                className="file-explorer__path-input-icon"
              />
            </div>

            {showSelectThisDir && (
              <FocusItem
                id="file-explorer-select-dir"
                actions={{ primary: handleSelectThisDirectory }}
                asChild
              >
                <button
                  className="file-explorer__item file-explorer__item--select-dir"
                  onClick={handleSelectThisDirectory}
                >
                  <span className="file-explorer__item-icon">
                    <CheckCircle size={22} weight="fill" />
                  </span>
                  <span>Select this directory</span>
                </button>
              </FocusItem>
            )}

            {showDriveList && (
              <>
                <div className="file-explorer__section-label">Drives</div>
                {drives.map((drive) => (
                  <FocusItem
                    key={drive}
                    actions={{
                      primary: () => {
                        setCurrentPath(drive);
                      },
                    }}
                    asChild
                  >
                    <button
                      className="file-explorer__item"
                      onClick={() => {
                        setCurrentPath(drive);
                      }}
                    >
                      <FolderIcon size={22} weight="fill" />
                      <span>{drive}</span>
                    </button>
                  </FocusItem>
                ))}
              </>
            )}

            {filteredEntries.length === 0 && !showDriveList && !isLoading && (
              <EmptyState
                className="file-explorer__empty"
                icon={<FolderOpen size={32} weight="fill" />}
                title="This folder is empty"
              />
            )}

            {filteredEntries.map((entry) => (
              <FocusItem
                key={entry.path}
                actions={{ primary: () => handleEntrySelect(entry) }}
                asChild
              >
                <button
                  className="file-explorer__item"
                  onClick={() => handleEntrySelect(entry)}
                >
                  <span className="file-explorer__item-icon">
                    {getEntryIcon(entry)}
                  </span>
                  <span className="file-explorer__item-name">{entry.name}</span>
                  <span className="file-explorer__item-meta">
                    {entry.isFile
                      ? formatSize(entry.size)
                      : entry.fileCount > 0
                        ? `${entry.fileCount} file${entry.fileCount !== 1 ? "s" : ""}`
                        : "Empty"}
                  </span>
                </button>
              </FocusItem>
            ))}
          </VerticalFocusGroup>
        )}
      </div>
    </Modal>
  );
}
