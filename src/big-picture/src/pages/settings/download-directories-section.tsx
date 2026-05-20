import "./download-directories-section.scss";

import type { DiskUsage, UserPreferences } from "@types";
import { DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID } from "./settings-navigation";
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
import {
  SETTINGS_HEADER_RETURN_TARGET,
  SETTINGS_SIDEBAR_RETURN_TARGET,
} from "./settings-navigation";

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

interface DirectoryGridSlot {
  index: number;
  startColumn: number;
  endColumn: number;
}

const EMPTY_DISK_USAGE: DiskUsage = { free: 0, total: 0 };
const DOWNLOAD_DIRECTORIES_REGION_ID = "download-directories-region";
const DOWNLOAD_DIRECTORIES_CONTROLS_REGION_ID =
  "download-directories-controls-region";
const DOWNLOAD_DIRECTORIES_DISKS_REGION_ID =
  "download-directories-disks-region";
const DOWNLOAD_DIRECTORIES_ADD_BUTTON_ID = "download-directories-add-button";

function getDirectoryCardFocusId(path: string) {
  return `download-directories-${path.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

function getDirectoryGridRows(
  directoryCount: number
): Array<Array<DirectoryGridSlot>> {
  switch (Math.min(directoryCount, MAX_DOWNLOAD_DIRECTORIES)) {
    case 1:
      return [[{ index: 0, startColumn: 1, endColumn: 6 }]];
    case 2:
      return [
        [
          { index: 0, startColumn: 1, endColumn: 3 },
          { index: 1, startColumn: 4, endColumn: 6 },
        ],
      ];
    case 3:
      return [
        [
          { index: 0, startColumn: 1, endColumn: 2 },
          { index: 1, startColumn: 3, endColumn: 4 },
          { index: 2, startColumn: 5, endColumn: 6 },
        ],
      ];
    case 4:
      return [
        [
          { index: 0, startColumn: 1, endColumn: 3 },
          { index: 1, startColumn: 4, endColumn: 6 },
        ],
        [
          { index: 2, startColumn: 1, endColumn: 3 },
          { index: 3, startColumn: 4, endColumn: 6 },
        ],
      ];
    case 5:
      return [
        [
          { index: 0, startColumn: 1, endColumn: 2 },
          { index: 1, startColumn: 3, endColumn: 4 },
          { index: 2, startColumn: 5, endColumn: 6 },
        ],
        [
          { index: 3, startColumn: 1, endColumn: 3 },
          { index: 4, startColumn: 4, endColumn: 6 },
        ],
      ];
    default:
      return [];
  }
}

function getDirectoryCardControlUpTargetId(
  directoryCount: number,
  index: number
): string {
  if (directoryCount <= 1) {
    return DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID;
  }

  if (directoryCount === 2) {
    return index === 0
      ? DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID
      : DOWNLOAD_DIRECTORIES_ADD_BUTTON_ID;
  }

  return index === 2
    ? DOWNLOAD_DIRECTORIES_ADD_BUTTON_ID
    : DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID;
}

function getGridColumnOverlap(
  left: DirectoryGridSlot,
  right: DirectoryGridSlot
) {
  return Math.max(
    0,
    Math.min(left.endColumn, right.endColumn) -
      Math.max(left.startColumn, right.startColumn) +
      1
  );
}

function getGridColumnCenter(slot: DirectoryGridSlot) {
  return (slot.startColumn + slot.endColumn) / 2;
}

function getClosestVerticalNeighbor(
  currentSlot: DirectoryGridSlot,
  candidateRow: Array<DirectoryGridSlot>
) {
  return candidateRow
    .map((candidateSlot) => ({
      candidateSlot,
      overlap: getGridColumnOverlap(currentSlot, candidateSlot),
      centerDistance: Math.abs(
        getGridColumnCenter(currentSlot) - getGridColumnCenter(candidateSlot)
      ),
    }))
    .sort((left, right) => {
      if (left.overlap !== right.overlap) {
        return right.overlap - left.overlap;
      }

      if (left.centerDistance !== right.centerDistance) {
        return left.centerDistance - right.centerDistance;
      }

      return left.candidateSlot.index - right.candidateSlot.index;
    })[0]?.candidateSlot;
}

function getDirectoryCardNavigationOverrides(
  directoryCount: number,
  index: number,
  focusIds: Array<string>
): FocusOverrides | undefined {
  const rows = getDirectoryGridRows(directoryCount);

  if (rows.length === 0) {
    return undefined;
  }

  const rowIndex = rows.findIndex((row) =>
    row.some((slot) => slot.index === index)
  );

  if (rowIndex === -1) {
    return undefined;
  }

  const row = rows[rowIndex];
  const slotIndex = row.findIndex((slot) => slot.index === index);
  const slot = row[slotIndex];

  if (!slot) {
    return undefined;
  }

  const previousSlot = slotIndex > 0 ? row[slotIndex - 1] : null;
  const nextSlot = slotIndex < row.length - 1 ? row[slotIndex + 1] : null;
  const rowAbove = rowIndex > 0 ? rows[rowIndex - 1] : null;
  const rowBelow = rowIndex < rows.length - 1 ? rows[rowIndex + 1] : null;
  const aboveSlot = rowAbove
    ? getClosestVerticalNeighbor(slot, rowAbove)
    : null;
  const belowSlot = rowBelow
    ? getClosestVerticalNeighbor(slot, rowBelow)
    : null;

  return {
    left: previousSlot
      ? getItemFocusTarget(focusIds[previousSlot.index])
      : index === 0
        ? SETTINGS_SIDEBAR_RETURN_TARGET
        : { type: "block" },
    right: nextSlot
      ? getItemFocusTarget(focusIds[nextSlot.index])
      : { type: "block" },
    up:
      aboveSlot != null
        ? getItemFocusTarget(focusIds[aboveSlot.index])
        : getItemFocusTarget(
            getDirectoryCardControlUpTargetId(directoryCount, index)
          ),
    down:
      belowSlot != null
        ? getItemFocusTarget(focusIds[belowSlot.index])
        : undefined,
  };
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
  const directoryFocusIds = useMemo(
    () =>
      directories.map((directory) => getDirectoryCardFocusId(directory.path)),
    [directories]
  );
  const directoryNavigationOverridesByFocusId = useMemo(
    () =>
      Object.fromEntries(
        directoryFocusIds.map((focusId, index) => [
          focusId,
          getDirectoryCardNavigationOverrides(
            directories.length,
            index,
            directoryFocusIds
          ),
        ])
      ),
    [directories.length, directoryFocusIds]
  );

  const controlsNavigationOverrides: FocusOverrides = useMemo(
    () => ({
      up: SETTINGS_HEADER_RETURN_TARGET,
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
              up: SETTINGS_HEADER_RETURN_TARGET,
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
              up: SETTINGS_HEADER_RETURN_TARGET,
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
          {directories.map((directory) => {
            const cardFocusId = getDirectoryCardFocusId(directory.path);

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
                focusNavigationOverrides={
                  directoryNavigationOverridesByFocusId[cardFocusId]
                }
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
