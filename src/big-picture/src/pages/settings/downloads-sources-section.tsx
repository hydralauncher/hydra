import "./downloads-sources-section.scss";

import type { DownloadSource } from "@types";
import { DownloadSourceStatus } from "@shared";
import { orderBy } from "lodash-es";
import { ArrowsClockwiseIcon, TrashIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  DownloadSourceCard,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import { ConfirmationModal } from "../../components/modals";
import { getItemFocusTarget } from "../../helpers";
import { useFormat } from "../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../layout";
import type { FocusOverrides } from "../../services";
import {
  DOWNLOADS_SOURCES_ACTIONS_REGION_ID,
  DOWNLOADS_SOURCES_DELETE_ALL_BUTTON_ID,
  DOWNLOADS_SOURCES_SECTION_REGION_ID,
  DOWNLOADS_SOURCES_SYNC_BUTTON_ID,
  getLastDownloadsBehaviorItemFocusId,
  getDownloadsSourceRemoveButtonFocusId,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface DownloadsSourcesSectionProps {
  className?: string;
}

function sortDownloadSources(downloadSources: DownloadSource[]) {
  return orderBy(downloadSources, "createdAt", "desc");
}

function isSyncingStatus(status: DownloadSourceStatus) {
  return (
    status === DownloadSourceStatus.PendingMatching ||
    status === DownloadSourceStatus.Matching
  );
}

function getStatusLabel(status: DownloadSourceStatus) {
  switch (status) {
    case DownloadSourceStatus.Matched:
      return "Up-to-date";
    case DownloadSourceStatus.Failed:
      return "Error";
    case DownloadSourceStatus.PendingMatching:
    case DownloadSourceStatus.Matching:
      return "Syncing";
  }
}

function getStatusTone(status: DownloadSourceStatus) {
  switch (status) {
    case DownloadSourceStatus.Failed:
      return "error" as const;
    case DownloadSourceStatus.Matched:
      return "success" as const;
    default:
      return "default" as const;
  }
}

export function DownloadsSourcesSection({
  className,
}: Readonly<DownloadsSourcesSectionProps>) {
  const { formatNumber } = useFormat();
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showDeleteAllConfirmation, setShowDeleteAllConfirmation] =
    useState(false);

  const refreshDownloadSources = useCallback(async () => {
    const nextSources = await globalThis.window.electron.getDownloadSources();
    setDownloadSources(sortDownloadSources(nextSources));
  }, []);

  useEffect(() => {
    void refreshDownloadSources();
  }, [refreshDownloadSources]);

  useEffect(() => {
    const hasPendingSource = downloadSources.some((downloadSource) =>
      isSyncingStatus(downloadSource.status)
    );

    if (!hasPendingSource || !downloadSources.length) {
      return;
    }

    const intervalId = globalThis.window.setInterval(() => {
      void refreshDownloadSources();
    }, 5000);

    return () => {
      globalThis.window.clearInterval(intervalId);
    };
  }, [downloadSources, refreshDownloadSources]);

  const isBusy = isSyncing || isRemoving;
  const hasSources = downloadSources.length > 0;
  const isWindows = globalThis.window.electron.platform === "win32";
  const firstRemoveButtonFocusId = downloadSources[0]
    ? getDownloadsSourceRemoveButtonFocusId(downloadSources[0].id)
    : null;
  const lastBehaviorFocusId = getLastDownloadsBehaviorItemFocusId(isWindows);

  const actionNavigationOverrides: FocusOverrides = useMemo(
    () => ({
      up: {
        type: "item",
        itemId: lastBehaviorFocusId,
      },
      down: firstRemoveButtonFocusId
        ? {
            type: "item",
            itemId: firstRemoveButtonFocusId,
          }
        : {
            type: "block",
          },
    }),
    [firstRemoveButtonFocusId, lastBehaviorFocusId]
  );

  const syncButtonNavigationOverrides: FocusOverrides = useMemo(
    () => ({
      ...actionNavigationOverrides,
      left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.settings),
      right: {
        type: "item",
        itemId: DOWNLOADS_SOURCES_DELETE_ALL_BUTTON_ID,
      },
    }),
    [actionNavigationOverrides]
  );

  const deleteAllButtonNavigationOverrides: FocusOverrides = useMemo(
    () => ({
      ...actionNavigationOverrides,
      left: {
        type: "item",
        itemId: DOWNLOADS_SOURCES_SYNC_BUTTON_ID,
      },
      right: {
        type: "block",
      },
    }),
    [actionNavigationOverrides]
  );

  const removeButtonNavigationOverridesBySourceId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      downloadSources.map((downloadSource, index) => {
        const previousSource = downloadSources[index - 1];
        const nextSource = downloadSources[index + 1];

        return [
          downloadSource.id,
          {
            up: previousSource
              ? {
                  type: "item",
                  itemId: getDownloadsSourceRemoveButtonFocusId(
                    previousSource.id
                  ),
                }
              : {
                  type: "region",
                  regionId: DOWNLOADS_SOURCES_ACTIONS_REGION_ID,
                  entryDirection: "up",
                  preferRememberedFocus: true,
                },
            down: nextSource
              ? {
                  type: "item",
                  itemId: getDownloadsSourceRemoveButtonFocusId(nextSource.id),
                }
              : {
                  type: "block",
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [downloadSources]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);

    try {
      await globalThis.window.electron.syncDownloadSources();
      await refreshDownloadSources();
    } finally {
      setIsSyncing(false);
    }
  }, [refreshDownloadSources]);

  const handleRemoveSource = useCallback(
    async (downloadSourceId: string) => {
      setIsRemoving(true);

      try {
        await globalThis.window.electron.removeDownloadSource(
          false,
          downloadSourceId
        );
        await refreshDownloadSources();
      } finally {
        setIsRemoving(false);
      }
    },
    [refreshDownloadSources]
  );

  const handleDeleteAllSources = useCallback(async () => {
    setIsRemoving(true);

    try {
      await globalThis.window.electron.removeDownloadSource(true);
      await refreshDownloadSources();
      setShowDeleteAllConfirmation(false);
    } finally {
      setIsRemoving(false);
    }
  }, [refreshDownloadSources]);

  return (
    <>
      <SettingsSection
        title="Sources"
        description="Hydra will fetch the download links from these sources. The source URL must be a direct link to a .json file containing the download the links."
        className={className}
      >
        <VerticalFocusGroup
          regionId={DOWNLOADS_SOURCES_SECTION_REGION_ID}
          className="downloads-sources-section__content"
        >
          <HorizontalFocusGroup
            regionId={DOWNLOADS_SOURCES_ACTIONS_REGION_ID}
            className="downloads-sources-section__actions"
            navigationOverrides={actionNavigationOverrides}
          >
            <div className="downloads-sources-section__actions-left">
              <Button
                variant="secondary"
                size="small"
                icon={<ArrowsClockwiseIcon size={18} />}
                focusId={DOWNLOADS_SOURCES_SYNC_BUTTON_ID}
                focusNavigationOverrides={syncButtonNavigationOverrides}
                disabled={!hasSources || isBusy}
                onClick={() => {
                  void handleSync();
                }}
              >
                Sync All
              </Button>
            </div>

            <div className="downloads-sources-section__actions-right">
              <Button
                variant="danger"
                size="small"
                icon={<TrashIcon size={18} />}
                focusId={DOWNLOADS_SOURCES_DELETE_ALL_BUTTON_ID}
                focusNavigationOverrides={deleteAllButtonNavigationOverrides}
                disabled={!hasSources || isBusy}
                onClick={() => {
                  setShowDeleteAllConfirmation(true);
                }}
              >
                Delete All
              </Button>
            </div>
          </HorizontalFocusGroup>

          {hasSources ? (
            <div className="downloads-sources-section__list">
              {downloadSources.map((downloadSource) => {
                const downloadCountLabel = `${formatNumber(
                  downloadSource.downloadCount
                )} download option${
                  downloadSource.downloadCount === 1 ? "" : "s"
                }`;

                return (
                  <DownloadSourceCard
                    key={downloadSource.id}
                    name={downloadSource.name}
                    countLabel={downloadCountLabel}
                    statusLabel={getStatusLabel(downloadSource.status)}
                    statusTone={getStatusTone(downloadSource.status)}
                    url={downloadSource.url}
                    removeButtonFocusId={getDownloadsSourceRemoveButtonFocusId(
                      downloadSource.id
                    )}
                    removeButtonNavigationOverrides={
                      removeButtonNavigationOverridesBySourceId[
                        downloadSource.id
                      ]
                    }
                    removeDisabled={isBusy}
                    onRemove={() => {
                      void handleRemoveSource(downloadSource.id);
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <p className="downloads-sources-section__empty">
              No sources available.
            </p>
          )}
        </VerticalFocusGroup>
      </SettingsSection>

      <ConfirmationModal
        visible={showDeleteAllConfirmation}
        title="Delete All Sources"
        description="This will remove every configured download source from Hydra."
        confirmLabel="Delete All"
        danger
        loading={isRemoving}
        onClose={() => {
          if (isBusy) return;

          setShowDeleteAllConfirmation(false);
        }}
        onConfirm={handleDeleteAllSources}
      />
    </>
  );
}
