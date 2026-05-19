import "./download-directories-section.scss";

import type { DiskUsage, UserPreferences } from "@types";
import {
  MAX_DOWNLOAD_DIRECTORIES,
  MAX_OPTIONAL_DOWNLOAD_DIRECTORIES,
  addOptionalDownloadDirectory,
  getDownloadDirectoryTitle,
  removeDownloadDirectory,
  resolveDownloadDirectories,
  setDefaultDownloadDirectory,
} from "@shared";
import {
  DotsThreeVerticalIcon,
  PlusCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Button,
  ContextMenu,
  DropdownSelect,
  type DropdownSelectOption,
  GridFocusGroup,
  HorizontalFocusGroup,
  UserDiskItem,
  VerticalFocusGroup,
  type ContextMenuItem,
} from "../../components";
import { getItemFocusTarget } from "../../helpers";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import { SettingsSection } from "./settings-section";

interface DownloadDirectoriesSectionProps {
  className?: string;
}

interface DownloadDirectory {
  title: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
  isSelected: boolean;
  canRemove: boolean;
}

interface DirectoryMenuState {
  path: string;
  title: string;
  visible: boolean;
  position: { x: number; y: number };
  restoreFocusId: string | null;
}

const EMPTY_DISK_USAGE: DiskUsage = { free: 0, total: 0 };
const DOWNLOAD_DIRECTORIES_REGION_ID = "download-directories-region";
const DOWNLOAD_DIRECTORIES_CONTROLS_REGION_ID =
  "download-directories-controls-region";
const DOWNLOAD_DIRECTORIES_DISKS_REGION_ID =
  "download-directories-disks-region";
const DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID =
  "download-directories-default-select";
const DOWNLOAD_DIRECTORIES_ADD_BUTTON_ID = "download-directories-add-button";

function getDirectoryCardFocusId(path: string) {
  return `download-directories-${path.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

function buildDirectoryMenuPosition(target: HTMLElement) {
  const rect = target.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function openDirectoryMenuFromElement(
  element: HTMLElement,
  directory: Pick<DownloadDirectory, "path" | "title">,
  restoreFocusId: string,
  setDirectoryMenu: Dispatch<SetStateAction<DirectoryMenuState | null>>
) {
  setDirectoryMenu({
    path: directory.path,
    title: directory.title,
    visible: true,
    position: buildDirectoryMenuPosition(element),
    restoreFocusId,
  });
}

function persistDownloadDirectoryPreferences(
  nextPreferences: Pick<
    UserPreferences,
    "downloadsPath" | "downloadDirectories" | "optionalDownloadsPaths"
  >
) {
  return globalThis.window.electron.updateUserPreferences({
    downloadsPath: nextPreferences.downloadsPath,
    downloadDirectories: nextPreferences.downloadDirectories,
    optionalDownloadsPaths: nextPreferences.optionalDownloadsPaths,
  });
}

export function DownloadDirectoriesSection({
  className,
}: Readonly<DownloadDirectoriesSectionProps>) {
  const userPreferences = useUserPreferences();
  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");
  const [diskUsageByPath, setDiskUsageByPath] = useState<
    Record<string, DiskUsage>
  >({});
  const [directoryMenu, setDirectoryMenu] = useState<DirectoryMenuState | null>(
    null
  );

  useEffect(() => {
    let isMounted = true;

    globalThis.window.electron.getDefaultDownloadsPath().then((path) => {
      if (!isMounted) return;

      setDefaultDownloadsPath(path);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const resolvedDirectories = useMemo(() => {
    if (!defaultDownloadsPath) {
      return null;
    }

    return resolveDownloadDirectories(userPreferences, defaultDownloadsPath);
  }, [defaultDownloadsPath, userPreferences]);

  useEffect(() => {
    if (!resolvedDirectories) {
      setDiskUsageByPath({});
      return;
    }

    let cancelled = false;

    const loadDiskUsage = async () => {
      const entries = await Promise.all(
        resolvedDirectories.allPaths.map(async (path) => {
          try {
            const usage =
              await globalThis.window.electron.getDiskFreeSpace(path);
            return [path, usage] as const;
          } catch {
            return [path, EMPTY_DISK_USAGE] as const;
          }
        })
      );

      if (cancelled) return;

      setDiskUsageByPath(Object.fromEntries(entries));
    };

    void loadDiskUsage();

    return () => {
      cancelled = true;
    };
  }, [resolvedDirectories]);

  const directories = useMemo<Array<DownloadDirectory>>(() => {
    if (!resolvedDirectories) {
      return [];
    }

    return resolvedDirectories.allPaths.map((path) => {
      const diskUsage = diskUsageByPath[path] ?? EMPTY_DISK_USAGE;
      const isSelected = path === resolvedDirectories.defaultPath;
      const canRemove = resolvedDirectories.optionalPaths.includes(path);

      return {
        title: getDownloadDirectoryTitle(path),
        path,
        freeBytes: diskUsage.free,
        totalBytes: diskUsage.total,
        isSelected,
        canRemove,
      };
    });
  }, [diskUsageByPath, resolvedDirectories]);

  const directoryOptions = useMemo<Array<DropdownSelectOption<string>>>(() => {
    return directories.map((directory) => ({
      value: directory.path,
      label: directory.title,
    }));
  }, [directories]);

  const selectedDefaultPath = resolvedDirectories?.defaultPath ?? "";
  const canAddDirectory =
    resolvedDirectories != null &&
    resolvedDirectories.savedPaths.length < MAX_OPTIONAL_DOWNLOAD_DIRECTORIES;
  const firstDirectoryFocusId = directories[0]
    ? getDirectoryCardFocusId(directories[0].path)
    : null;
  const disksLayoutClassName = `download-directories-section__disks download-directories-section__disks--${Math.min(
    directories.length,
    MAX_DOWNLOAD_DIRECTORIES
  )}`;

  const controlsNavigationOverrides: FocusOverrides = useMemo(
    () => ({
      down: firstDirectoryFocusId
        ? getItemFocusTarget(firstDirectoryFocusId)
        : undefined,
    }),
    [firstDirectoryFocusId]
  );
  const disksNavigationOverrides: FocusOverrides = useMemo(
    () => ({
      up: {
        type: "region",
        regionId: DOWNLOAD_DIRECTORIES_CONTROLS_REGION_ID,
        entryDirection: "up",
        preferRememberedFocus: true,
      },
    }),
    []
  );

  const handleDefaultDirectoryChange = useCallback(
    async (nextDefaultPath: string) => {
      if (!defaultDownloadsPath) return;

      const nextPreferences = setDefaultDownloadDirectory(
        userPreferences,
        nextDefaultPath,
        defaultDownloadsPath
      );

      await persistDownloadDirectoryPreferences(nextPreferences);
    },
    [defaultDownloadsPath, userPreferences]
  );

  const handleAddDirectory = useCallback(async () => {
    if (!resolvedDirectories || !defaultDownloadsPath || !canAddDirectory) {
      return;
    }

    const { filePaths } = await globalThis.window.electron.showOpenDialog({
      defaultPath: resolvedDirectories.defaultPath,
      properties: ["openDirectory"],
    });
    const nextPath = filePaths?.[0];

    if (!nextPath) return;

    const nextPreferences = addOptionalDownloadDirectory(
      userPreferences,
      nextPath,
      defaultDownloadsPath
    );

    await persistDownloadDirectoryPreferences(nextPreferences);
  }, [
    canAddDirectory,
    defaultDownloadsPath,
    resolvedDirectories,
    userPreferences,
  ]);

  const handleRemoveDirectory = useCallback(
    async (pathToRemove: string) => {
      if (!defaultDownloadsPath) return;

      const nextPreferences = removeDownloadDirectory(
        userPreferences,
        pathToRemove,
        defaultDownloadsPath
      );

      setDirectoryMenu(null);
      await persistDownloadDirectoryPreferences(nextPreferences);
    },
    [defaultDownloadsPath, userPreferences]
  );

  const menuItems = useMemo<Array<ContextMenuItem>>(() => {
    if (!directoryMenu) return [];

    return [
      {
        id: `remove-${directoryMenu.path}`,
        label: "Remove",
        icon: <TrashIcon size={18} />,
        danger: true,
        onSelect: async () => {
          await handleRemoveDirectory(directoryMenu.path);
        },
      },
    ];
  }, [directoryMenu, handleRemoveDirectory]);

  return (
    <SettingsSection
      title="Downloads Directories"
      description="Choose the default download location and add new directories for future game downloads."
      className={className}
    >
      <VerticalFocusGroup regionId={DOWNLOAD_DIRECTORIES_REGION_ID}>
        <HorizontalFocusGroup
          className="download-directories-section__controls"
          regionId={DOWNLOAD_DIRECTORIES_CONTROLS_REGION_ID}
          navigationOverrides={controlsNavigationOverrides}
        >
          <DropdownSelect
            className="download-directories-section__select"
            hideLabel
            value={selectedDefaultPath}
            options={directoryOptions}
            onValueChange={handleDefaultDirectoryChange}
            ariaLabel="Default download directory"
            focusId={DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID}
            focusNavigationOverrides={{
              right: getItemFocusTarget(DOWNLOAD_DIRECTORIES_ADD_BUTTON_ID),
              down: firstDirectoryFocusId
                ? getItemFocusTarget(firstDirectoryFocusId)
                : undefined,
            }}
          />

          <Button
            variant="secondary"
            size="small"
            icon={<PlusCircleIcon size={20} />}
            className="download-directories-section__add-button"
            disabled={!canAddDirectory}
            focusId={DOWNLOAD_DIRECTORIES_ADD_BUTTON_ID}
            focusNavigationOverrides={{
              left: getItemFocusTarget(DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID),
              down: firstDirectoryFocusId
                ? getItemFocusTarget(firstDirectoryFocusId)
                : undefined,
            }}
            onClick={() => {
              void handleAddDirectory();
            }}
          >
            Add Directory
          </Button>
        </HorizontalFocusGroup>

        <GridFocusGroup
          className={disksLayoutClassName}
          regionId={DOWNLOAD_DIRECTORIES_DISKS_REGION_ID}
          navigationOverrides={disksNavigationOverrides}
        >
          {directories.map((directory, index) => {
            const cardFocusId = getDirectoryCardFocusId(directory.path);
            const upTargetId =
              directories.length === 1
                ? DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID
                : index % 3 === 2
                  ? DOWNLOAD_DIRECTORIES_ADD_BUTTON_ID
                  : DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID;

            return (
              <UserDiskItem
                key={directory.path}
                title={directory.title}
                path={directory.path}
                freeBytes={directory.freeBytes}
                totalBytes={directory.totalBytes}
                isSelected={directory.isSelected}
                className="download-directories-section__disk"
                focusId={cardFocusId}
                focusNavigationOverrides={{
                  up: getItemFocusTarget(upTargetId),
                }}
                focusActions={{
                  primary: "off",
                  press: directory.canRemove
                    ? {
                        y: () => {
                          const element =
                            globalThis.document.getElementById(cardFocusId);

                          if (!(element instanceof HTMLElement)) return;

                          openDirectoryMenuFromElement(
                            element,
                            directory,
                            cardFocusId,
                            setDirectoryMenu
                          );
                        },
                      }
                    : undefined,
                }}
                topRightContent={
                  directory.canRemove ? (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="download-directories-section__disk-action"
                      icon={<DotsThreeVerticalIcon size={18} weight="bold" />}
                      aria-label={`Open actions for ${directory.title}`}
                      focusable={false}
                      onClick={(
                        event: ReactMouseEvent<HTMLButtonElement, MouseEvent>
                      ) => {
                        openDirectoryMenuFromElement(
                          event.currentTarget,
                          directory,
                          cardFocusId,
                          setDirectoryMenu
                        );
                      }}
                    >
                      {null}
                    </Button>
                  ) : null
                }
              />
            );
          })}
        </GridFocusGroup>
      </VerticalFocusGroup>

      <ContextMenu
        ariaLabel={
          directoryMenu
            ? `Directory actions for ${directoryMenu.title}`
            : "Directory actions"
        }
        items={menuItems}
        visible={directoryMenu?.visible ?? false}
        position={directoryMenu?.position ?? { x: 0, y: 0 }}
        restoreFocusId={directoryMenu?.restoreFocusId ?? null}
        onClose={() => setDirectoryMenu(null)}
      />
    </SettingsSection>
  );
}
