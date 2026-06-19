import {
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  KebabHorizontalIcon,
  PencilIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  EmulatorConfig,
} from "@types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  ContextMenu,
  FocusItem,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../../components";
import { ConfirmationModal } from "../../../components/modals";
import {
  useBigPictureToast,
  useNavigation,
  useUserDetails,
} from "../../../hooks";
import {
  EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID,
  EMULATION_DETAIL_CLOUD_SAVES_REGION_ID,
  getEmulationCloudMenuFocusId,
} from "../settings-navigation";
import { SETTINGS_TOAST_OPTIONS } from "./shared";
import { EmulationCloudRestoreModal } from "./emulation-cloud-restore-modal";

import { useCloudConnector } from "@renderer/hooks/use-cloud-connector";

import ConsoleBackside from "@renderer/assets/emulation/console-backside.svg?react";
import hydraSaveCard from "@renderer/assets/emulation/icons/hydra-save-card.png";

interface CloudSavesSectionProps {
  config: EmulatorConfig;
  refreshKey: number;
  upTargetId: string;
}

interface RestoreModalProps {
  save: EmulationCloudSave | null;
  platform: EmulationSavePlatform;
  onClose: () => void;
  onRestored: () => void;
}

interface RenameModalProps {
  save: EmulationCloudSave | null;
  onClose: () => void;
  onRenamed: () => void;
}

const RESTORE_MODAL_REGION_ID = "emulation-cloud-restore-modal-region";
const RESTORE_MODAL_ACTIONS_REGION_ID = "emulation-cloud-restore-modal-actions";
const RESTORE_MODAL_PICK_BUTTON_ID = "emulation-cloud-restore-pick-button";
const RESTORE_MODAL_CONFIRM_BUTTON_ID = "emulation-cloud-restore-confirm";
const RENAME_MODAL_REGION_ID = "emulation-cloud-rename-modal-region";
const RENAME_MODAL_ACTIONS_REGION_ID = "emulation-cloud-rename-modal-actions";
const RENAME_MODAL_INPUT_ID = "emulation-cloud-rename-input";
const RENAME_MODAL_CONFIRM_BUTTON_ID = "emulation-cloud-rename-confirm";

const formatDate = (iso: string | null): string => {
  if (!iso) return "—";

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

function RestoreModal({
  save,
  platform,
  onClose,
  onRestored,
}: Readonly<RestoreModalProps>) {
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  return (
    <EmulationCloudRestoreModal
      save={save}
      platform={platform}
      onClose={onClose}
      onRestored={onRestored}
      onRestoreSuccess={() =>
        showSuccessToast("Cloud save restored", SETTINGS_TOAST_OPTIONS)
      }
      onRestoreError={() =>
        showErrorToast("Failed to restore cloud save", SETTINGS_TOAST_OPTIONS)
      }
      regionId={RESTORE_MODAL_REGION_ID}
      actionsRegionId={RESTORE_MODAL_ACTIONS_REGION_ID}
      pickButtonId={RESTORE_MODAL_PICK_BUTTON_ID}
      confirmButtonId={RESTORE_MODAL_CONFIRM_BUTTON_ID}
      modalClassName="emulation-settings__modal"
    />
  );
}

function RenameModal({ save, onClose, onRenamed }: Readonly<RenameModalProps>) {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigation();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [value, setValue] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    setValue(save?.label ?? save?.fileName ?? "");
  }, [save]);

  useEffect(() => {
    if (!save) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(RENAME_MODAL_INPUT_ID);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [save, setFocus]);

  const handleRename = useCallback(async () => {
    if (!save || value.trim().length === 0) return;

    setIsBusy(true);

    try {
      await globalThis.window.electron.updateEmulationSaveLabel(
        save.id,
        value.trim()
      );
      showSuccessToast("Cloud save renamed", SETTINGS_TOAST_OPTIONS);
      onRenamed();
      onClose();
    } catch {
      showErrorToast("Failed to rename cloud save", SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsBusy(false);
    }
  }, [onClose, onRenamed, save, showErrorToast, showSuccessToast, value]);

  return (
    <Modal
      visible={save !== null}
      title={t("cloud_rename_title")}
      description={t("cloud_rename_description")}
      onClose={onClose}
      className="emulation-settings__modal"
    >
      <VerticalFocusGroup
        regionId={RENAME_MODAL_REGION_ID}
        className="emu-save-modal__rename"
      >
        <Input
          focusId={RENAME_MODAL_INPUT_ID}
          label={t("cloud_rename_label")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />

        <HorizontalFocusGroup
          regionId={RENAME_MODAL_ACTIONS_REGION_ID}
          className="emu-save-modal__actions"
        >
          <Button variant="secondary" disabled={isBusy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            focusId={RENAME_MODAL_CONFIRM_BUTTON_ID}
            loading={isBusy}
            disabled={value.trim().length === 0}
            onClick={() => {
              void handleRename();
            }}
          >
            {t("cloud_rename_confirm")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}

export function CloudSavesSection({
  config,
  refreshKey,
  upTargetId,
}: Readonly<CloudSavesSectionProps>) {
  const { t } = useTranslation("settings");
  const { hasActiveSubscription } = useUserDetails();
  const { showSuccessToast } = useBigPictureToast();
  const platform = config.system as EmulationSavePlatform;
  const [saves, setSaves] = useState<EmulationCloudSave[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<EmulationCloudSave | null>(
    null
  );
  const [renameTarget, setRenameTarget] = useState<EmulationCloudSave | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<EmulationCloudSave | null>(
    null
  );
  const [openMenu, setOpenMenu] = useState<{
    key: string;
    position: { x: number; y: number };
  } | null>(null);

  const { stageRef, consoleRef, gridRef, connector } = useCloudConnector(saves);

  const loadSaves = useCallback(async () => {
    if (!hasActiveSubscription) {
      setSaves([]);
      return;
    }

    setIsRefreshing(true);

    try {
      setSaves(await globalThis.window.electron.listEmulationSaves(platform));
    } finally {
      setIsRefreshing(false);
    }
  }, [hasActiveSubscription, platform]);

  useEffect(() => {
    void loadSaves();
  }, [loadSaves, refreshKey]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;

    await globalThis.window.electron.deleteEmulationSave(deleteTarget.id);
    setDeleteTarget(null);
    showSuccessToast("Cloud save removed", SETTINGS_TOAST_OPTIONS);
    await loadSaves();
  }, [deleteTarget, loadSaves, showSuccessToast]);

  if (!hasActiveSubscription || saves.length === 0) {
    return null;
  }

  const firstSaveMenuId = getEmulationCloudMenuFocusId(saves[0]!.id);

  return (
    <>
      <VerticalFocusGroup
        regionId={EMULATION_DETAIL_CLOUD_SAVES_REGION_ID}
        className="emulator-detail__section emulator-detail__cloud-section"
      >
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("cloud_saves_section_title")}</h3>
            <p>{t("cloud_saves_section_description")}</p>
          </div>
          <HorizontalFocusGroup className="emulator-detail__section-actions">
            <Button
              focusId={EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID}
              focusNavigationOverrides={{
                left: { type: "block" },
                right: { type: "block" },
                up: { type: "item", itemId: upTargetId },
                down: { type: "item", itemId: firstSaveMenuId },
              }}
              variant="secondary"
              disabled={isRefreshing}
              icon={
                <SyncIcon
                  size={13}
                  className={
                    isRefreshing
                      ? "emulator-detail__redetect-icon--spinning"
                      : undefined
                  }
                />
              }
              onClick={() => {
                void loadSaves();
              }}
            >
              {t("cloud_refresh")}
            </Button>
          </HorizontalFocusGroup>
        </header>

        <div className="emulator-detail__cloud-stage" ref={stageRef}>
          <div className="emulator-detail__cloud-console" ref={consoleRef}>
            <ConsoleBackside />
          </div>

          <svg
            className="emulator-detail__cloud-connector"
            width={connector.width}
            height={connector.height}
            viewBox={`0 0 ${connector.width} ${connector.height}`}
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            {connector.path ? (
              <path
                d={connector.path}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </svg>

          <div className="emulator-detail__cloud-grid" ref={gridRef}>
            {saves.map((save, index) => {
              const saveName = save.label ?? save.fileName;
              const menuId = getEmulationCloudMenuFocusId(save.id);
              const previousSave = saves[index - 1];
              const nextSave = saves[index + 1];

              return (
                <div key={save.id} className="emulator-detail__cloud-card">
                  <div className="emulator-detail__cloud-card-top">
                    <img
                      className="emulator-detail__cloud-card-art"
                      src={hydraSaveCard}
                      alt=""
                    />

                    <FocusItem
                      id={menuId}
                      navigationOverrides={{
                        left: previousSave
                          ? {
                              type: "item",
                              itemId: getEmulationCloudMenuFocusId(
                                previousSave.id
                              ),
                            }
                          : {
                              type: "block",
                            },
                        right: nextSave
                          ? {
                              type: "item",
                              itemId: getEmulationCloudMenuFocusId(nextSave.id),
                            }
                          : {
                              type: "block",
                            },
                        up: {
                          type: "item",
                          itemId: EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID,
                        },
                      }}
                      asChild
                    >
                      <button
                        type="button"
                        className="emulator-detail__cloud-menu"
                        aria-label={saveName}
                        onClick={(event) => {
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          setOpenMenu({
                            key: save.id,
                            position: {
                              x: rect.right - 8,
                              y: rect.bottom + 8,
                            },
                          });
                        }}
                      >
                        <KebabHorizontalIcon
                          size={16}
                          className="emulator-detail__cloud-menu-icon"
                        />
                      </button>
                    </FocusItem>

                    <ContextMenu
                      visible={openMenu?.key === save.id}
                      position={openMenu?.position ?? { x: 0, y: 0 }}
                      restoreFocusId={menuId}
                      onClose={() => setOpenMenu(null)}
                      ariaLabel={saveName}
                      items={[
                        {
                          id: "restore",
                          icon: <HistoryIcon size={16} />,
                          label: t("cloud_restore"),
                          onSelect: () => setRestoreTarget(save),
                        },
                        {
                          id: "rename",
                          icon: <PencilIcon size={16} />,
                          label: t("cloud_rename_title"),
                          onSelect: () => setRenameTarget(save),
                        },
                        {
                          id: "delete",
                          icon: <TrashIcon size={16} />,
                          label: t("cloud_delete"),
                          danger: true,
                          onSelect: () => setDeleteTarget(save),
                        },
                      ]}
                    />
                  </div>

                  <span
                    className="emulator-detail__cloud-card-title"
                    title={saveName}
                  >
                    {saveName}
                  </span>

                  <div className="emulator-detail__cloud-card-info">
                    <span title={save.hostname ?? undefined}>
                      <DeviceDesktopIcon size={16} />
                      {save.hostname ?? "—"}
                    </span>
                    <span>
                      <ClockIcon size={16} />
                      {formatDate(save.localLastModifiedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </VerticalFocusGroup>

      <RestoreModal
        save={restoreTarget}
        platform={platform}
        onClose={() => setRestoreTarget(null)}
        onRestored={() => {
          void loadSaves();
        }}
      />

      <RenameModal
        save={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={() => {
          void loadSaves();
        }}
      />

      <ConfirmationModal
        visible={deleteTarget !== null}
        title={t("cloud_delete_title")}
        description={t("cloud_delete_description", {
          name: deleteTarget?.label ?? deleteTarget?.fileName ?? "",
        })}
        confirmLabel={t("cloud_delete")}
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}
