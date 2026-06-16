import {
  ChevronRightIcon,
  DownloadIcon,
  FileDirectoryIcon,
  KebabHorizontalIcon,
  QuestionIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import type {
  EmulationSavePlatform,
  EmulatorConfig,
  EmulatorSystem,
  MemcardExportResult,
  MemcardScanInput,
  MemcardScanProgress,
  MemoryCardSaveRecord,
} from "@types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  ContextMenu,
  FocusItem,
  GridFocusGroup,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../../components";
import { ConfirmationModal } from "../../../components/modals";
import {
  useBigPictureToast,
  useNavigation,
  useUserDetails,
} from "../../../hooks";
import { getSkuRegion, getSkuRegionFlag } from "@renderer/helpers";
import {
  EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID,
  EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
  EMULATION_DETAIL_MEMORY_CARDS_REGION_ID,
  getEmulationMemcardBackupAllFocusId,
  getEmulationMemcardGroupCollapseFocusId,
  getEmulationMemcardMenuFocusId,
  getEmulationMemcardRemoveCardFocusId,
} from "../settings-navigation";
import { SETTINGS_TOAST_OPTIONS, formatBytes } from "./shared";

interface MemoryCardsSectionProps {
  config: EmulatorConfig;
  upTargetId: string;
  downTargetId: string;
  onUploaded?: () => void;
}

interface MemoryCardScanSummary {
  cardCount: number;
  saveCount: number;
  matched: number;
  unmatched: number;
}

interface MemoryCardScanModalProps {
  visible: boolean;
  system: EmulatorSystem;
  input: MemcardScanInput;
  onComplete: (summary: MemoryCardScanSummary) => void;
  onClose: () => void;
}

interface MemcardApi {
  list: () => Promise<MemoryCardSaveRecord[]>;
  forgetCard: (cardFilePath: string) => Promise<void>;
  exportSave: (
    cardFilePath: string,
    name: string,
    suggestedName: string
  ) => Promise<MemcardExportResult>;
}

const SCAN_MODAL_REGION_ID = "emulation-memcard-scan-modal-region";
const SCAN_MODAL_ACTIONS_REGION_ID = "emulation-memcard-scan-modal-actions";
const SCAN_MODAL_CANCEL_BUTTON_ID = "emulation-memcard-scan-modal-cancel";
const SCAN_MODAL_CONTINUE_BUTTON_ID = "emulation-memcard-scan-modal-continue";

const ps2Api: MemcardApi = {
  list: () => globalThis.window.electron.listPs2MemcardSaves(),
  forgetCard: (cardFilePath) =>
    globalThis.window.electron.forgetPs2MemcardCard(cardFilePath),
  exportSave: (cardFilePath, folderName, suggestedName) =>
    globalThis.window.electron.exportPs2Save(
      cardFilePath,
      folderName,
      suggestedName
    ),
};

const ps1Api: MemcardApi = {
  list: () => globalThis.window.electron.listPs1MemcardSaves(),
  forgetCard: (cardFilePath) =>
    globalThis.window.electron.forgetPs1MemcardCard(cardFilePath),
  exportSave: (cardFilePath, folderName, suggestedName) =>
    globalThis.window.electron.exportPs1Save(
      cardFilePath,
      folderName,
      suggestedName
    ),
};

const PICK_FILTERS = {
  ps1: {
    name: "PS1 Memory Card",
    extensions: ["mcd", "mcr", "mc", "gme", "vgs", "vmp"],
  },
  ps2: { name: "PS2 Memory Card", extensions: ["ps2", "mcd", "mc2"] },
} as const;

const saveKey = (save: MemoryCardSaveRecord) =>
  `${save.cardFilePath}::${save.folderName}`;

function countKey(isPs1: boolean, count: number) {
  if (isPs1) {
    return count === 1
      ? "memcard_blocks_count_one"
      : "memcard_blocks_count_other";
  }

  return count === 1 ? "memcard_files_count_one" : "memcard_files_count_other";
}

function scanApiFor(system: EmulatorSystem) {
  return system === "ps1"
    ? {
        scan: globalThis.window.electron.scanPs1Memcards,
        cancel: globalThis.window.electron.cancelPs1MemcardScan,
        onProgress: globalThis.window.electron.onPs1MemcardScanProgress,
      }
    : {
        scan: globalThis.window.electron.scanPs2Memcards,
        cancel: globalThis.window.electron.cancelPs2MemcardScan,
        onProgress: globalThis.window.electron.onPs2MemcardScanProgress,
      };
}

function MemoryCardScanModal({
  visible,
  system,
  input,
  onComplete,
  onClose,
}: Readonly<MemoryCardScanModalProps>) {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigation();
  const [phase, setPhase] = useState<
    "scanning" | "matching" | "done" | "error"
  >("scanning");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [matched, setMatched] = useState(0);
  const [summary, setSummary] = useState<MemoryCardScanSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!visible) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(SCAN_MODAL_CANCEL_BUTTON_ID);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [setFocus, visible]);

  useEffect(() => {
    if (!visible) return undefined;

    setPhase("scanning");
    setProcessed(0);
    setTotal(0);
    setCurrentLabel(null);
    setMatched(0);
    setSummary(null);
    setErrorMessage(null);

    const api = scanApiFor(system);
    let cancelled = false;

    void (async () => {
      const { requestId } = await api.scan(input);
      if (cancelled) {
        await api.cancel(requestId);
        return;
      }

      requestIdRef.current = requestId;
      unsubscribeRef.current = api.onProgress(
        requestId,
        (payload: MemcardScanProgress) => {
          if (payload.type === "scan_progress") {
            setPhase("scanning");
            setProcessed(payload.processed);
            setTotal(payload.total);
            setCurrentLabel(payload.currentCard);
            return;
          }

          if (payload.type === "match_progress") {
            setPhase("matching");
            setProcessed(payload.processed);
            setTotal(payload.total);
            setCurrentLabel(payload.currentSave);
            setMatched(payload.matched);
            return;
          }

          unsubscribeRef.current?.();
          unsubscribeRef.current = null;

          if (payload.type === "done") {
            setPhase("done");
            setSummary({
              cardCount: payload.cardCount,
              saveCount: payload.saveCount,
              matched: payload.matched,
              unmatched: payload.unmatched,
            });
            return;
          }

          if (payload.type === "error") {
            setPhase("error");
            setErrorMessage(payload.message);
          }
        }
      );
    })();

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;

      if (requestIdRef.current) {
        void api.cancel(requestIdRef.current);
      }
      requestIdRef.current = null;
    };
  }, [input, system, visible]);

  const percent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isComplete = phase === "done";
  const isError = phase === "error";
  const isPending = !isComplete && !isError;

  return (
    <Modal
      visible={visible}
      title={t("memory_cards_section_title")}
      description={t("memcard_scan_intro")}
      onClose={onClose}
      closeOnBackdrop={!isPending}
      closeOnEscape={!isPending}
      closeOnB={!isPending}
      className="emulation-settings__scan-modal-shell"
    >
      <VerticalFocusGroup
        regionId={SCAN_MODAL_REGION_ID}
        className="emulation-settings__scan-modal"
      >
        <div className="emulation-settings__scan-modal-copy">
          <p className="emulation-settings__scan-phase">
            {isError
              ? t("memcard_scan_failed")
              : isComplete
                ? t("memcard_scan_complete")
                : phase === "scanning"
                  ? t("memcard_scanning")
                  : t("memcard_matching")}
          </p>

          {!isError ? (
            <>
              <div className="emulation-settings__progress">
                <div
                  className="emulation-settings__progress-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="emulation-settings__scan-meta">
                {t("setup_scan_count", {
                  processed,
                  total: Math.max(total, processed),
                })}
              </p>
              {currentLabel ? (
                <p className="emulation-settings__scan-current">
                  {currentLabel}
                </p>
              ) : null}
            </>
          ) : (
            <p className="emulation-settings__scan-error">
              {errorMessage ?? t("memcard_scan_failed")}
            </p>
          )}

          <div className="emulation-settings__scan-stats">
            <div className="emulation-settings__scan-stat">
              <span className="emulation-settings__scan-stat-label">
                {t("memcard_stat_matched")}
              </span>
              <strong>
                {isComplete ? (summary?.matched ?? matched) : matched}
              </strong>
            </div>
            <div className="emulation-settings__scan-stat">
              <span className="emulation-settings__scan-stat-label">
                {t("memcard_stat_saves")}
              </span>
              <strong>{summary?.saveCount ?? processed}</strong>
            </div>
          </div>
        </div>

        <HorizontalFocusGroup
          regionId={SCAN_MODAL_ACTIONS_REGION_ID}
          className="emulation-settings__modal-actions"
        >
          <Button
            focusId={SCAN_MODAL_CANCEL_BUTTON_ID}
            variant="secondary"
            onClick={onClose}
          >
            {isPending ? t("setup_cancel_scan") : "Close"}
          </Button>
          <Button
            focusId={SCAN_MODAL_CONTINUE_BUTTON_ID}
            disabled={!isComplete}
            onClick={() => {
              if (summary) onComplete(summary);
            }}
          >
            {t("setup_continue")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}

export function MemoryCardsSection({
  config,
  upTargetId,
  downTargetId,
  onUploaded,
}: Readonly<MemoryCardsSectionProps>) {
  const { t } = useTranslation("settings");
  const { hasActiveSubscription } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const isPs1 = config.system === "ps1";
  const api = isPs1 ? ps1Api : ps2Api;
  const platform = config.system as EmulationSavePlatform;

  const [saves, setSaves] = useState<MemoryCardSaveRecord[]>([]);
  const [scanInput, setScanInput] = useState<MemcardScanInput | null>(null);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [backingUpKey, setBackingUpKey] = useState<string | null>(null);
  const [backingUpCard, setBackingUpCard] = useState<string | null>(null);
  const [forgetCardTarget, setForgetCardTarget] = useState<{
    cardFilePath: string;
    cardLabel: string;
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<{
    key: string;
    position: { x: number; y: number };
  } | null>(null);
  const didInitCollapse = useRef(false);

  const loadSaves = useCallback(async () => {
    const list = await api.list();
    setSaves(list);
  }, [api]);

  useEffect(() => {
    void loadSaves();
  }, [loadSaves]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { cardLabel: string; records: MemoryCardSaveRecord[] }
    >();

    for (const save of saves) {
      const group = map.get(save.cardFilePath) ?? {
        cardLabel: save.cardLabel,
        records: [],
      };
      group.records.push(save);
      map.set(save.cardFilePath, group);
    }

    return Array.from(map.entries()).map(([cardFilePath, group]) => ({
      cardFilePath,
      cardLabel: group.cardLabel,
      records: group.records,
    }));
  }, [saves]);

  useEffect(() => {
    if (didInitCollapse.current || groups.length === 0) return;
    didInitCollapse.current = true;
    setCollapsed(new Set(groups.map((group) => group.cardFilePath)));
  }, [groups]);

  const firstGroupFocusId = groups[0]
    ? getEmulationMemcardGroupCollapseFocusId(groups[0].cardFilePath)
    : downTargetId;

  const toggleCard = useCallback((cardFilePath: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(cardFilePath)) next.delete(cardFilePath);
      else next.add(cardFilePath);
      return next;
    });
  }, []);

  const handlePickFile = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [isPs1 ? PICK_FILTERS.ps1 : PICK_FILTERS.ps2],
    });

    if (result.canceled || result.filePaths.length === 0) return;
    setScanInput({ autoDetect: false, manualPaths: result.filePaths });
  }, [isPs1]);

  const handleExport = useCallback(
    async (save: MemoryCardSaveRecord) => {
      setExportingKey(saveKey(save));
      try {
        const result = await api.exportSave(
          save.cardFilePath,
          save.folderName,
          save.sku ?? save.folderName
        );

        if (result.ok && result.location) {
          showSuccessToast("Save exported", {
            ...SETTINGS_TOAST_OPTIONS,
            message: result.location,
          });
        } else if (result.error && result.error !== "cancelled") {
          showErrorToast("Failed to export save", SETTINGS_TOAST_OPTIONS);
        }
      } finally {
        setExportingKey(null);
      }
    },
    [api, showErrorToast, showSuccessToast]
  );

  const handleBackup = useCallback(
    async (save: MemoryCardSaveRecord) => {
      setBackingUpKey(saveKey(save));
      try {
        await globalThis.window.electron.uploadEmulationSave(
          platform,
          save.cardFilePath,
          save.folderName
        );
        showSuccessToast("Cloud backup complete", SETTINGS_TOAST_OPTIONS);
        onUploaded?.();
      } catch {
        showErrorToast("Cloud backup failed", SETTINGS_TOAST_OPTIONS);
      } finally {
        setBackingUpKey(null);
      }
    },
    [onUploaded, platform, showErrorToast, showSuccessToast]
  );

  const handleBackupAll = useCallback(
    async (cardFilePath: string) => {
      setBackingUpCard(cardFilePath);
      try {
        const result =
          await globalThis.window.electron.uploadEmulationSavesForCard(
            platform,
            cardFilePath
          );
        showSuccessToast("Cloud backup complete", {
          ...SETTINGS_TOAST_OPTIONS,
          message: `${result.uploaded}/${result.total} saves uploaded.`,
        });
        onUploaded?.();
      } catch {
        showErrorToast("Cloud backup failed", SETTINGS_TOAST_OPTIONS);
      } finally {
        setBackingUpCard(null);
      }
    },
    [onUploaded, platform, showErrorToast, showSuccessToast]
  );

  const handleForgetCard = useCallback(async () => {
    if (!forgetCardTarget) return;
    await api.forgetCard(forgetCardTarget.cardFilePath);
    setForgetCardTarget(null);
    await loadSaves();
    showSuccessToast("Memory card removed", SETTINGS_TOAST_OPTIONS);
  }, [api, forgetCardTarget, loadSaves, showSuccessToast]);

  return (
    <>
      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("memory_cards_section_title")}</h3>
          </div>
          <HorizontalFocusGroup className="emulator-detail__section-actions">
            <Button
              focusId={EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID}
              focusNavigationOverrides={{
                left: { type: "block" },
                right: {
                  type: "item",
                  itemId: EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID,
                },
                up: { type: "item", itemId: upTargetId },
                down: { type: "item", itemId: firstGroupFocusId },
              }}
              variant="secondary"
              icon={<FileDirectoryIcon size={14} />}
              onClick={() => {
                void handlePickFile();
              }}
            >
              {t(isPs1 ? "pick_memory_card_file_ps1" : "pick_memory_card_file")}
            </Button>
            <Button
              focusId={EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID}
              focusNavigationOverrides={{
                left: {
                  type: "item",
                  itemId: EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
                },
                right: { type: "block" },
                up: { type: "item", itemId: upTargetId },
                down: { type: "item", itemId: firstGroupFocusId },
              }}
              variant="secondary"
              icon={<SyncIcon size={13} />}
              onClick={() => setScanInput({ autoDetect: true })}
            >
              {saves.length > 0
                ? t("redetect_memory_cards")
                : t("detect_memory_cards")}
            </Button>
          </HorizontalFocusGroup>
        </header>

        {saves.length === 0 ? (
          <p className="emulator-detail__empty">
            {t(isPs1 ? "no_memory_cards_ps1" : "no_memory_cards")}
          </p>
        ) : (
          <VerticalFocusGroup
            regionId={EMULATION_DETAIL_MEMORY_CARDS_REGION_ID}
            className="emulator-detail__memcards"
          >
            {groups.map(({ cardFilePath, cardLabel, records }, index) => {
              const isCollapsed = collapsed.has(cardFilePath);
              const collapseId =
                getEmulationMemcardGroupCollapseFocusId(cardFilePath);
              const backupAllId =
                getEmulationMemcardBackupAllFocusId(cardFilePath);
              const removeCardId =
                getEmulationMemcardRemoveCardFocusId(cardFilePath);
              const previousGroup = groups[index - 1];
              const nextGroup = groups[index + 1];
              const firstRecord = records[0];
              const firstRecordMenuId = firstRecord
                ? getEmulationMemcardMenuFocusId(saveKey(firstRecord))
                : null;
              return (
                <div
                  key={cardFilePath}
                  className="emulator-detail__memcard-group"
                >
                  <div className="emulator-detail__memcard-group-header">
                    <FocusItem
                      id={collapseId}
                      navigationOverrides={{
                        left: { type: "block" },
                        right: hasActiveSubscription
                          ? {
                              type: "item",
                              itemId: backupAllId,
                            }
                          : {
                              type: "item",
                              itemId: removeCardId,
                            },
                        up: previousGroup
                          ? {
                              type: "item",
                              itemId: getEmulationMemcardGroupCollapseFocusId(
                                previousGroup.cardFilePath
                              ),
                            }
                          : {
                              type: "item",
                              itemId:
                                EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
                            },
                        down:
                          !isCollapsed && firstRecordMenuId
                            ? {
                                type: "item",
                                itemId: firstRecordMenuId,
                              }
                            : nextGroup
                              ? {
                                  type: "item",
                                  itemId:
                                    getEmulationMemcardGroupCollapseFocusId(
                                      nextGroup.cardFilePath
                                    ),
                                }
                              : {
                                  type: "item",
                                  itemId: downTargetId,
                                },
                      }}
                      asChild
                    >
                      <button
                        type="button"
                        className="emulator-detail__memcard-collapse"
                        onClick={() => toggleCard(cardFilePath)}
                        aria-label={
                          isCollapsed
                            ? t("expand_memory_card")
                            : t("collapse_memory_card")
                        }
                      >
                        <span
                          className={`emulator-detail__memcard-chevron${
                            isCollapsed
                              ? ""
                              : " emulator-detail__memcard-chevron--expanded"
                          }`}
                        >
                          <ChevronRightIcon size={16} />
                        </span>
                        <span className="emulator-detail__memcard-group-title">
                          {cardLabel}
                        </span>
                        <span className="emulator-detail__memcard-group-count">
                          {t(
                            records.length === 1
                              ? "memcard_group_count_one"
                              : "memcard_group_count_other",
                            { count: records.length }
                          )}
                        </span>
                      </button>
                    </FocusItem>

                    {hasActiveSubscription ? (
                      <FocusItem
                        id={backupAllId}
                        navigationOverrides={{
                          left: {
                            type: "item",
                            itemId: collapseId,
                          },
                          right: {
                            type: "item",
                            itemId: removeCardId,
                          },
                          up: previousGroup
                            ? {
                                type: "item",
                                itemId: getEmulationMemcardBackupAllFocusId(
                                  previousGroup.cardFilePath
                                ),
                              }
                            : {
                                type: "item",
                                itemId:
                                  EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID,
                              },
                          down:
                            !isCollapsed && firstRecordMenuId
                              ? {
                                  type: "item",
                                  itemId: firstRecordMenuId,
                                }
                              : nextGroup
                                ? {
                                    type: "item",
                                    itemId: getEmulationMemcardBackupAllFocusId(
                                      nextGroup.cardFilePath
                                    ),
                                  }
                                : {
                                    type: "item",
                                    itemId: downTargetId,
                                  },
                        }}
                        asChild
                      >
                        <button
                          type="button"
                          className="emulator-detail__memcard-backup-all"
                          onClick={() => {
                            void handleBackupAll(cardFilePath);
                          }}
                          disabled={backingUpCard === cardFilePath}
                        >
                          <UploadIcon size={13} />
                          <span>
                            {backingUpCard === cardFilePath
                              ? t("cloud_backing_up")
                              : t("cloud_backup_all")}
                          </span>
                        </button>
                      </FocusItem>
                    ) : null}

                    <Button
                      focusId={removeCardId}
                      focusNavigationOverrides={{
                        left: {
                          type: "item",
                          itemId: hasActiveSubscription
                            ? backupAllId
                            : collapseId,
                        },
                        right: { type: "block" },
                        up: previousGroup
                          ? {
                              type: "item",
                              itemId: getEmulationMemcardRemoveCardFocusId(
                                previousGroup.cardFilePath
                              ),
                            }
                          : {
                              type: "item",
                              itemId:
                                EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID,
                            },
                        down:
                          !isCollapsed && firstRecordMenuId
                            ? {
                                type: "item",
                                itemId: firstRecordMenuId,
                              }
                            : nextGroup
                              ? {
                                  type: "item",
                                  itemId: getEmulationMemcardRemoveCardFocusId(
                                    nextGroup.cardFilePath
                                  ),
                                }
                              : {
                                  type: "item",
                                  itemId: downTargetId,
                                },
                      }}
                      variant="danger"
                      size="small"
                      icon={<TrashIcon size={16} />}
                      onClick={() =>
                        setForgetCardTarget({
                          cardFilePath,
                          cardLabel,
                        })
                      }
                    >
                      {t("remove")}
                    </Button>
                  </div>

                  {!isCollapsed ? (
                    <GridFocusGroup className="emulator-detail__memcard-grid">
                      {records.map((save, saveIndex) => {
                        const cover = save.libraryImageUrl ?? save.iconUrl;
                        const title = save.title ?? save.folderName;
                        const region = save.sku ? getSkuRegion(save.sku) : null;
                        const currentKey = saveKey(save);
                        const menuId =
                          getEmulationMemcardMenuFocusId(currentKey);
                        const previousSave = records[saveIndex - 1];
                        const nextSave = records[saveIndex + 1];

                        return (
                          <div
                            key={currentKey}
                            className="emulator-detail__memcard-card"
                          >
                            <div className="emulator-detail__memcard-cover">
                              {cover ? (
                                <img src={cover} alt={title} loading="lazy" />
                              ) : (
                                <div className="emulator-detail__memcard-cover-placeholder">
                                  <QuestionIcon size={20} />
                                </div>
                              )}
                            </div>

                            <div className="emulator-detail__memcard-info">
                              <span
                                className="emulator-detail__memcard-title"
                                title={title}
                              >
                                {title}
                              </span>
                              <span className="emulator-detail__memcard-sub">
                                {region ? (
                                  <img
                                    className="emulator-detail__memcard-flag"
                                    src={getSkuRegionFlag(region)}
                                    alt={region}
                                    title={region}
                                  />
                                ) : null}
                                {save.sku ?? save.folderName}
                              </span>
                              <span className="emulator-detail__memcard-meta">
                                {`${formatBytes(save.sizeBytes)} · ${t(
                                  countKey(isPs1, save.fileCount),
                                  { count: save.fileCount }
                                )}`}
                              </span>
                            </div>

                            <FocusItem
                              id={menuId}
                              navigationOverrides={{
                                left: previousSave
                                  ? {
                                      type: "item",
                                      itemId: getEmulationMemcardMenuFocusId(
                                        saveKey(previousSave)
                                      ),
                                    }
                                  : {
                                      type: "block",
                                    },
                                right: nextSave
                                  ? {
                                      type: "item",
                                      itemId: getEmulationMemcardMenuFocusId(
                                        saveKey(nextSave)
                                      ),
                                    }
                                  : {
                                      type: "block",
                                    },
                                up: {
                                  type: "item",
                                  itemId: collapseId,
                                },
                              }}
                              asChild
                            >
                              <button
                                type="button"
                                className="emulator-detail__memcard-menu"
                                aria-label={title}
                                onClick={(event) => {
                                  const rect =
                                    event.currentTarget.getBoundingClientRect();
                                  setOpenMenu({
                                    key: currentKey,
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
                              visible={openMenu?.key === currentKey}
                              position={openMenu?.position ?? { x: 0, y: 0 }}
                              restoreFocusId={menuId}
                              onClose={() => setOpenMenu(null)}
                              ariaLabel={title}
                              items={[
                                {
                                  id: "export",
                                  icon: <DownloadIcon size={16} />,
                                  label:
                                    exportingKey === currentKey
                                      ? t("memcard_exporting")
                                      : t(
                                          isPs1
                                            ? "memcard_export_mcs"
                                            : "memcard_export"
                                        ),
                                  disabled: exportingKey === currentKey,
                                  onSelect: () => handleExport(save),
                                },
                                {
                                  id: "backup",
                                  icon: <UploadIcon size={16} />,
                                  label:
                                    backingUpKey === currentKey
                                      ? t("cloud_backing_up")
                                      : t("cloud_backup"),
                                  disabled:
                                    !hasActiveSubscription ||
                                    backingUpKey === currentKey,
                                  onSelect: () => handleBackup(save),
                                },
                              ]}
                            />
                          </div>
                        );
                      })}
                    </GridFocusGroup>
                  ) : null}
                </div>
              );
            })}
          </VerticalFocusGroup>
        )}
      </section>

      {scanInput ? (
        <MemoryCardScanModal
          visible={scanInput !== null}
          system={config.system}
          input={scanInput}
          onComplete={(summary) => {
            setScanInput(null);
            void loadSaves();
            showSuccessToast("Memory card scan complete", {
              ...SETTINGS_TOAST_OPTIONS,
              message: `${summary.matched} matched, ${summary.unmatched} unmatched.`,
            });
          }}
          onClose={() => setScanInput(null)}
        />
      ) : null}

      <ConfirmationModal
        visible={forgetCardTarget !== null}
        title={t("forget_memcard_card_title")}
        description={t("forget_memcard_card_description", {
          name: forgetCardTarget?.cardLabel ?? "",
        })}
        confirmLabel={t("forget_memcard_card_confirm")}
        danger
        onClose={() => setForgetCardTarget(null)}
        onConfirm={handleForgetCard}
      />
    </>
  );
}
