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
  MemcardRestoreTarget,
} from "@types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  getEmulationCloudRestoreTargetFocusId,
} from "../settings-navigation";
import { SETTINGS_TOAST_OPTIONS, basename } from "./shared";

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

interface Connector {
  width: number;
  height: number;
  path: string;
}

const SLOT_X_RATIO = 59.5 / 411;
const SLOT_Y_RATIO = 129 / 221;
const BRANCH_GAP = 40;
const CORNER_RADIUS = 8;

const RESTORE_MODAL_REGION_ID = "emulation-cloud-restore-modal-region";
const RESTORE_MODAL_ACTIONS_REGION_ID = "emulation-cloud-restore-modal-actions";
const RESTORE_MODAL_PICK_BUTTON_ID = "emulation-cloud-restore-pick-button";
const RESTORE_MODAL_CONFIRM_BUTTON_ID = "emulation-cloud-restore-confirm";
const RENAME_MODAL_REGION_ID = "emulation-cloud-rename-modal-region";
const RENAME_MODAL_ACTIONS_REGION_ID = "emulation-cloud-rename-modal-actions";
const RENAME_MODAL_INPUT_ID = "emulation-cloud-rename-input";
const RENAME_MODAL_CONFIRM_BUTTON_ID = "emulation-cloud-rename-confirm";

const PICK_FILTERS: Record<
  EmulationSavePlatform,
  { name: string; extensions: string[] }
> = {
  ps1: {
    name: "PS1 Memory Card",
    extensions: ["mcd", "mcr", "mc", "gme", "vgs", "vmp"],
  },
  ps2: { name: "PS2 Memory Card", extensions: ["ps2", "mcd", "mc2"] },
};

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
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigation();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [targets, setTargets] = useState<MemcardRestoreTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!save) return;

    void globalThis.window.electron
      .getMemcardRestoreTargets(platform)
      .then((foundTargets) => {
        setTargets(foundTargets);
        setSelectedTarget(foundTargets[0]?.cardFilePath ?? null);
      });
  }, [platform, save]);

  useEffect(() => {
    if (!save) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(
        selectedTarget
          ? getEmulationCloudRestoreTargetFocusId(selectedTarget)
          : RESTORE_MODAL_PICK_BUTTON_ID
      );
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [save, selectedTarget, setFocus]);

  const handlePickFile = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [PICK_FILTERS[platform]],
    });

    if (result.canceled || result.filePaths.length === 0) return;

    const chosenPath = result.filePaths[0];
    setTargets((current) =>
      current.some((target) => target.cardFilePath === chosenPath)
        ? current
        : [
            ...current,
            {
              cardFilePath: chosenPath,
              cardLabel: basename(chosenPath),
            },
          ]
    );
    setSelectedTarget(chosenPath);
  }, [platform]);

  const handleRestore = useCallback(async () => {
    if (!save || !selectedTarget) return;

    setIsBusy(true);

    try {
      const result = await globalThis.window.electron.restoreEmulationSave(
        platform,
        save.id,
        selectedTarget
      );

      if (result.ok) {
        showSuccessToast("Cloud save restored", SETTINGS_TOAST_OPTIONS);
        onRestored();
        onClose();
      } else {
        showErrorToast("Failed to restore cloud save", SETTINGS_TOAST_OPTIONS);
      }
    } finally {
      setIsBusy(false);
    }
  }, [
    onClose,
    onRestored,
    platform,
    save,
    selectedTarget,
    showErrorToast,
    showSuccessToast,
  ]);

  return (
    <Modal
      visible={save !== null}
      title={t("cloud_restore_title")}
      description={t("cloud_restore_description")}
      onClose={onClose}
      className="emulation-settings__modal"
    >
      <VerticalFocusGroup
        regionId={RESTORE_MODAL_REGION_ID}
        className="emu-save-modal__restore"
      >
        <div className="emu-save-modal__targets">
          {targets.length === 0 ? (
            <div className="emu-save-modal__empty">
              {t("cloud_restore_no_cards")}
            </div>
          ) : (
            targets.map((target) => {
              const targetId = getEmulationCloudRestoreTargetFocusId(
                target.cardFilePath
              );
              const isSelected = selectedTarget === target.cardFilePath;

              return (
                <FocusItem key={target.cardFilePath} id={targetId} asChild>
                  <button
                    type="button"
                    className={`emu-save-modal__target${
                      isSelected ? " emu-save-modal__target--selected" : ""
                    }`}
                    onClick={() => setSelectedTarget(target.cardFilePath)}
                  >
                    <span className="emu-save-modal__target-name">
                      {target.cardLabel}
                    </span>
                    <span className="emu-save-modal__target-path">
                      {target.cardFilePath}
                    </span>
                  </button>
                </FocusItem>
              );
            })
          )}
        </div>

        <HorizontalFocusGroup
          regionId={RESTORE_MODAL_ACTIONS_REGION_ID}
          className="emu-save-modal__actions"
        >
          <Button
            focusId={RESTORE_MODAL_PICK_BUTTON_ID}
            variant="secondary"
            disabled={isBusy}
            onClick={() => {
              void handlePickFile();
            }}
          >
            {t("cloud_restore_pick_file")}
          </Button>
          <Button
            focusId={RESTORE_MODAL_CONFIRM_BUTTON_ID}
            loading={isBusy}
            disabled={!selectedTarget}
            onClick={() => {
              void handleRestore();
            }}
          >
            {t("cloud_restore_confirm")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
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

  const stageRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [connector, setConnector] = useState<Connector>({
    width: 0,
    height: 0,
    path: "",
  });

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

  const drawConnector = useCallback(() => {
    const stage = stageRef.current;
    const consoleElement = consoleRef.current;
    const grid = gridRef.current;

    if (!stage || !consoleElement || !grid) return;

    const stageRect = stage.getBoundingClientRect();
    const consoleRect = consoleElement.getBoundingClientRect();
    const cards = Array.from(
      grid.querySelectorAll<HTMLElement>(".emulator-detail__cloud-card")
    );

    if (cards.length === 0) {
      setConnector({
        width: stageRect.width,
        height: stageRect.height,
        path: "",
      });
      return;
    }

    const slotX =
      consoleRect.left - stageRect.left + SLOT_X_RATIO * consoleRect.width;
    const slotY =
      consoleRect.top - stageRect.top + SLOT_Y_RATIO * consoleRect.height;

    const centers = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        x: rect.left - stageRect.left + rect.width / 2,
        top: rect.top - stageRect.top,
      };
    });
    const cardTop = Math.min(...centers.map((center) => center.top));
    const busY = cardTop - BRANCH_GAP;
    const xs = centers.map((center) => center.x);
    const first = xs[0];
    const last = xs[xs.length - 1];
    const segments = [`M ${slotX} ${slotY} L ${slotX} ${busY}`];

    if (first === last) {
      segments.push(`M ${first} ${busY} L ${first} ${cardTop}`);
      segments.push(
        `M ${Math.min(slotX, first)} ${busY} L ${Math.max(slotX, first)} ${busY}`
      );
    } else {
      const radius = Math.min(CORNER_RADIUS, (last - first) / 2);
      segments.push(
        `M ${first} ${cardTop} L ${first} ${busY + radius} Q ${first} ${busY} ${
          first + radius
        } ${busY} L ${last - radius} ${busY} Q ${last} ${busY} ${last} ${
          busY + radius
        } L ${last} ${cardTop}`
      );

      for (let index = 1; index < xs.length - 1; index += 1) {
        segments.push(`M ${xs[index]} ${busY} L ${xs[index]} ${cardTop}`);
      }

      if (slotX < first) {
        segments.push(`M ${slotX} ${busY} L ${first} ${busY}`);
      }

      if (slotX > last) {
        segments.push(`M ${last} ${busY} L ${slotX} ${busY}`);
      }
    }

    setConnector({
      width: stageRect.width,
      height: stageRect.height,
      path: segments.join(" "),
    });
  }, []);

  useLayoutEffect(() => {
    drawConnector();

    const observer = new ResizeObserver(drawConnector);
    if (stageRef.current) observer.observe(stageRef.current);

    return () => observer.disconnect();
  }, [drawConnector, saves]);

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
