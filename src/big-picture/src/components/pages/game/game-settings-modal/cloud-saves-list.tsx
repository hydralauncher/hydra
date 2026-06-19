import {
  CloudIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import type { GameArtifact } from "@types";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDate } from "../../../../hooks";
import {
  Button,
  ContextMenu,
  EmptyState,
  HorizontalFocusGroup,
  Skeleton,
  VerticalFocusGroup,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";

interface CloudSavesListProps {
  artifacts: GameArtifact[];
  loading?: boolean;
  restoringArtifactId: string | null;
  updatingArtifactId: string | null;
  deletingArtifactId: string | null;
  onRestoreArtifact: (artifactId: string) => Promise<void>;
  onToggleArtifactFreeze: (
    artifactId: string,
    freeze: boolean
  ) => Promise<void>;
  onDeleteArtifact: (artifactId: string) => Promise<void>;
  hideFreeze?: boolean;
}

function getArtifactRestoreButtonId(artifactId: string) {
  return `game-cloud-settings-restore-${artifactId}`;
}

function getArtifactOptionsButtonId(artifactId: string) {
  return `game-cloud-settings-options-${artifactId}`;
}

export function CloudSavesList({
  artifacts,
  loading = false,
  restoringArtifactId,
  updatingArtifactId,
  deletingArtifactId,
  onRestoreArtifact,
  onToggleArtifactFreeze,
  onDeleteArtifact,
  hideFreeze = false,
}: Readonly<CloudSavesListProps>) {
  const { t } = useTranslation("big_picture");
  const { formatDate, formatDateTime } = useDate();
  const [openMenu, setOpenMenu] = useState<{
    artifactId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GameArtifact | null>(null);

  const sortedArtifacts = useMemo(
    () =>
      [...artifacts].sort((left, right) => {
        if (hideFreeze || left.isFrozen === right.isFrozen) {
          return (
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
          );
        }

        return left.isFrozen ? -1 : 1;
      }),
    [artifacts, hideFreeze]
  );

  if (loading) {
    return (
      <div className="game-cloud-settings-tab__saves-shell">
        <div className="game-cloud-settings-tab__saves-viewport">
          <div className="game-cloud-settings-tab__saves-list">
            <Skeleton className="game-cloud-settings-tab__save-skeleton" />
            <Skeleton className="game-cloud-settings-tab__save-skeleton" />
          </div>
        </div>
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <EmptyState
        icon={<CloudIcon size={32} />}
        title={t("edit_game_no_backups")}
        description={t("no_backups")}
      />
    );
  }

  return (
    <>
      <div className="game-cloud-settings-tab__saves-shell">
        <VerticalFocusGroup
          asChild
          className="game-cloud-settings-tab__saves-viewport"
        >
          <div>
            <div className="game-cloud-settings-tab__saves-list">
              {sortedArtifacts.map((artifact) => {
                const artifactTitle =
                  artifact.label ??
                  artifact.downloadOptionTitle ??
                  t("backup_from", {
                    date: formatDate(artifact.createdAt),
                  });
                const deviceName =
                  artifact.hostname || t("backup_info_unknown_device");
                const artifactInfo = `${formatDateTime(artifact.createdAt)} · ${deviceName}`;
                const isRestoring = restoringArtifactId === artifact.id;
                const isUpdating = updatingArtifactId === artifact.id;
                const isDeleting = deletingArtifactId === artifact.id;
                const isBusy = isRestoring || isUpdating || isDeleting;
                const optionsButtonId = getArtifactOptionsButtonId(artifact.id);

                return (
                  <div
                    key={artifact.id}
                    className="game-cloud-settings-tab__save-card"
                  >
                    <div className="game-cloud-settings-tab__save-copy">
                      <p
                        className="game-cloud-settings-tab__save-title"
                        title={artifactTitle}
                      >
                        {artifactTitle}
                      </p>
                      <p
                        className="game-cloud-settings-tab__save-info"
                        title={artifactInfo}
                      >
                        {artifactInfo}
                      </p>
                    </div>

                    <HorizontalFocusGroup asChild>
                      <div className="game-cloud-settings-tab__save-actions">
                        <Button
                          focusId={getArtifactRestoreButtonId(artifact.id)}
                          variant="secondary"
                          className="game-cloud-settings-tab__save-restore-button"
                          loading={isRestoring}
                          disabled={isUpdating || isDeleting}
                          icon={<DownloadSimpleIcon size={20} weight="bold" />}
                          onClick={() => {
                            void onRestoreArtifact(artifact.id);
                          }}
                        >
                          {t("restore_backup")}
                        </Button>

                        <Button
                          focusId={optionsButtonId}
                          variant="secondary"
                          size="icon"
                          className="game-cloud-settings-tab__save-options-button"
                          disabled={isBusy}
                          aria-label={t("cloud_backup_options")}
                          focusNavigationOverrides={{
                            left: {
                              type: "item",
                              itemId: getArtifactRestoreButtonId(artifact.id),
                            },
                          }}
                          onClick={(event) => {
                            const rect =
                              event.currentTarget.getBoundingClientRect();

                            setOpenMenu({
                              artifactId: artifact.id,
                              position: {
                                x: rect.right - 8,
                                y: rect.bottom + 8,
                              },
                            });
                          }}
                        >
                          <DotsThreeVerticalIcon size={20} weight="bold" />
                        </Button>

                        <ContextMenu
                          visible={openMenu?.artifactId === artifact.id}
                          position={openMenu?.position ?? { x: 0, y: 0 }}
                          restoreFocusId={optionsButtonId}
                          onClose={() => setOpenMenu(null)}
                          ariaLabel={t("cloud_backup_options")}
                          items={[
                            ...(hideFreeze
                              ? []
                              : [
                                  {
                                    id: artifact.isFrozen
                                      ? "unfreeze"
                                      : "freeze",
                                    label: artifact.isFrozen
                                      ? t("unfreeze_backup")
                                      : t("freeze_backup"),
                                    disabled: isBusy,
                                    onSelect: () =>
                                      onToggleArtifactFreeze(
                                        artifact.id,
                                        !artifact.isFrozen
                                      ),
                                  } as const,
                                ]),
                            {
                              id: "delete",
                              label: t("delete_backup"),
                              danger: true,
                              disabled:
                                isBusy || (!hideFreeze && artifact.isFrozen),
                              onSelect: () => {
                                setDeleteTarget(artifact);
                              },
                            },
                          ]}
                        />
                      </div>
                    </HorizontalFocusGroup>
                  </div>
                );
              })}
            </div>
          </div>
        </VerticalFocusGroup>
      </div>

      <ConfirmationModal
        visible={deleteTarget !== null}
        title={t("delete_backup")}
        description={t("cloud_delete_backup_description")}
        confirmLabel={t("delete_backup")}
        danger
        loading={deleteTarget ? deletingArtifactId === deleteTarget.id : false}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;

          try {
            await onDeleteArtifact(deleteTarget.id);
            setDeleteTarget(null);
          } catch {
            // Keep the confirmation modal open so the user can retry or cancel.
          }
        }}
      />
    </>
  );
}
