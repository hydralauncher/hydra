import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

import { Button, ConfirmationModal } from "@renderer/components";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { useToast, useUserDetails } from "@renderer/hooks";
import { getSkuRegion, getSkuRegionFlag } from "@renderer/helpers";
import type {
  EmulationSavePlatform,
  EmulatorConfig,
  MemcardExportResult,
  MemcardScanInput,
  MemoryCardSaveRecord,
} from "@types";

import {
  MemoryCardScanModal,
  type MemcardScanSummary,
} from "./memory-card-scan-modal";

interface Props {
  config: EmulatorConfig;
  /** Called after a successful cloud back-up so the Cloud saves list refreshes. */
  onUploaded?: () => void;
}

// PS1 (DuckStation) and PS2 (PCSX2) saves share the same UI; only the backing
// IPC, the manual-pick file filter and a little copy differ. This binds the
// component to the right system's handlers.
interface MemcardApi {
  list: () => Promise<MemoryCardSaveRecord[]>;
  forgetSave: (cardFilePath: string, name: string) => Promise<void>;
  forgetCard: (cardFilePath: string) => Promise<void>;
  exportSave: (
    cardFilePath: string,
    name: string,
    suggestedName: string
  ) => Promise<MemcardExportResult>;
}

const ps2Api: MemcardApi = {
  list: () => window.electron.listPs2MemcardSaves(),
  forgetSave: (c, n) => window.electron.forgetPs2MemcardSave(c, n),
  forgetCard: (c) => window.electron.forgetPs2MemcardCard(c),
  exportSave: (c, n, s) => window.electron.exportPs2Save(c, n, s),
};

const ps1Api: MemcardApi = {
  list: () => window.electron.listPs1MemcardSaves(),
  forgetSave: (c, n) => window.electron.forgetPs1MemcardSave(c, n),
  forgetCard: (c) => window.electron.forgetPs1MemcardCard(c),
  exportSave: (c, n, s) => window.electron.exportPs1Save(c, n, s),
};

const PICK_FILTERS = {
  ps1: {
    name: "PS1 Memory Card",
    extensions: ["mcd", "mcr", "mc", "gme", "vgs", "vmp"],
  },
  ps2: { name: "PS2 Memory Card", extensions: ["ps2", "mcd", "mc2"] },
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const saveKey = (save: MemoryCardSaveRecord): string =>
  `${save.cardFilePath}::${save.folderName}`;

// PS1 saves span fixed 8 KB blocks; PS2 saves hold a count of files.
const countKey = (isPs1: boolean, count: number): string => {
  if (isPs1) {
    return count === 1
      ? "memcard_blocks_count_one"
      : "memcard_blocks_count_other";
  }
  return count === 1 ? "memcard_files_count_one" : "memcard_files_count_other";
};

export function MemoryCardsSection({ config, onUploaded }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();

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
  const didInitCollapse = useRef(false);

  const loadSaves = useCallback(async () => {
    const list = await api.list();
    setSaves(list);
  }, [api]);

  useEffect(() => {
    loadSaves();
  }, [loadSaves]);

  // Group by card file path (not label) so two cards sharing a basename in
  // different folders don't collapse into one group.
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
    setCollapsed(new Set(groups.map((g) => g.cardFilePath)));
  }, [groups]);

  const toggleCard = useCallback((cardFilePath: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cardFilePath)) next.delete(cardFilePath);
      else next.add(cardFilePath);
      return next;
    });
  }, []);

  const handlePickFile = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [isPs1 ? PICK_FILTERS.ps1 : PICK_FILTERS.ps2],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    setScanInput({ autoDetect: false, manualPaths: result.filePaths });
  }, [isPs1]);

  const handleScanComplete = useCallback(
    (summary: MemcardScanSummary) => {
      setScanInput(null);
      loadSaves();
      showSuccessToast(
        t("memcard_scan_done_toast", {
          saves: summary.saveCount,
          matched: summary.matched,
        })
      );
    },
    [loadSaves, showSuccessToast, t]
  );

  const handleExport = useCallback(
    async (save: MemoryCardSaveRecord) => {
      setExportingKey(saveKey(save));
      try {
        const res = await api.exportSave(
          save.cardFilePath,
          save.folderName,
          save.sku ?? save.folderName
        );
        if (res.ok && res.location) {
          showSuccessToast(t("memcard_export_success", { path: res.location }));
        } else if (res.error && res.error !== "cancelled") {
          showErrorToast(t("memcard_export_failed"));
        }
      } finally {
        setExportingKey(null);
      }
    },
    [api, showSuccessToast, showErrorToast, t]
  );

  const handleBackup = useCallback(
    async (save: MemoryCardSaveRecord) => {
      setBackingUpKey(saveKey(save));
      try {
        await window.electron.uploadEmulationSave(
          platform,
          save.cardFilePath,
          save.folderName
        );
        showSuccessToast(t("cloud_backup_success"));
        onUploaded?.();
      } catch {
        showErrorToast(t("cloud_backup_failed"));
      } finally {
        setBackingUpKey(null);
      }
    },
    [platform, showSuccessToast, showErrorToast, t, onUploaded]
  );

  const handleBackupAll = useCallback(
    async (cardFilePath: string) => {
      setBackingUpCard(cardFilePath);
      try {
        const res = await window.electron.uploadEmulationSavesForCard(
          platform,
          cardFilePath
        );
        showSuccessToast(
          t("cloud_backup_all_done", {
            uploaded: res.uploaded,
            total: res.total,
          })
        );
        onUploaded?.();
      } catch {
        showErrorToast(t("cloud_backup_failed"));
      } finally {
        setBackingUpCard(null);
      }
    },
    [platform, showSuccessToast, showErrorToast, t, onUploaded]
  );

  const handleForgetCard = useCallback(async () => {
    if (!forgetCardTarget) return;
    await api.forgetCard(forgetCardTarget.cardFilePath);
    setForgetCardTarget(null);
    loadSaves();
  }, [api, forgetCardTarget, loadSaves]);

  return (
    <>
      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("memory_cards_section_title")}</h3>
          </div>
          <div className="emulator-detail__section-actions">
            <Button theme="outline" onClick={handlePickFile}>
              <FileDirectoryIcon size={14} />
              <span>
                {t(
                  isPs1 ? "pick_memory_card_file_ps1" : "pick_memory_card_file"
                )}
              </span>
            </Button>
            <Button
              theme="outline"
              onClick={() => setScanInput({ autoDetect: true })}
            >
              <SyncIcon size={13} />
              <span>
                {saves.length > 0
                  ? t("redetect_memory_cards")
                  : t("detect_memory_cards")}
              </span>
            </Button>
          </div>
        </header>

        {saves.length === 0 ? (
          <p className="emulator-detail__empty">
            {t(isPs1 ? "no_memory_cards_ps1" : "no_memory_cards")}
          </p>
        ) : (
          <div className="emulator-detail__memcards">
            {groups.map(({ cardFilePath, cardLabel, records }) => {
              const isCollapsed = collapsed.has(cardFilePath);
              return (
                <div
                  key={cardFilePath}
                  className="emulator-detail__memcard-group"
                >
                  <div className="emulator-detail__memcard-group-header">
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
                    {hasActiveSubscription && (
                      <button
                        type="button"
                        className="emulator-detail__memcard-backup-all"
                        onClick={() => handleBackupAll(cardFilePath)}
                        disabled={backingUpCard === cardFilePath}
                      >
                        <UploadIcon size={13} />
                        <span>
                          {backingUpCard === cardFilePath
                            ? t("cloud_backing_up")
                            : t("cloud_backup_all")}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="emulator-detail__remove"
                      onClick={() =>
                        setForgetCardTarget({ cardFilePath, cardLabel })
                      }
                      aria-label={t("remove_memory_card")}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                  {!isCollapsed && (
                    <div className="emulator-detail__memcard-grid">
                      {records.map((save) => {
                        const cover = save.libraryImageUrl ?? save.iconUrl;
                        const exporting = exportingKey === saveKey(save);
                        const title = save.title ?? save.folderName;
                        const region = save.sku ? getSkuRegion(save.sku) : null;
                        return (
                          <div
                            key={saveKey(save)}
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
                                {region && (
                                  <img
                                    className="emulator-detail__memcard-flag"
                                    src={getSkuRegionFlag(region)}
                                    alt={region}
                                    title={region}
                                  />
                                )}
                                {save.sku ?? save.folderName}
                              </span>
                              <span className="emulator-detail__memcard-meta">
                                {`${formatBytes(save.sizeBytes)} · ${t(
                                  countKey(isPs1, save.fileCount),
                                  { count: save.fileCount }
                                )}`}
                              </span>
                            </div>
                            <DropdownMenu
                              align="end"
                              items={[
                                {
                                  icon: <DownloadIcon size={16} />,
                                  label: exporting
                                    ? t("memcard_exporting")
                                    : t(
                                        isPs1
                                          ? "memcard_export_mcs"
                                          : "memcard_export"
                                      ),
                                  disabled: exporting,
                                  onClick: () => handleExport(save),
                                },
                                {
                                  icon: <UploadIcon size={16} />,
                                  label:
                                    backingUpKey === saveKey(save)
                                      ? t("cloud_backing_up")
                                      : t("cloud_backup"),
                                  disabled: backingUpKey === saveKey(save),
                                  show: hasActiveSubscription,
                                  onClick: () => handleBackup(save),
                                },
                              ]}
                            >
                              <button
                                type="button"
                                className="emulator-detail__memcard-menu"
                                aria-label={title}
                              >
                                <KebabHorizontalIcon
                                  size={16}
                                  className="emulator-detail__cloud-menu-icon"
                                />
                              </button>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {scanInput && (
        <MemoryCardScanModal
          visible={scanInput !== null}
          system={config.system}
          input={scanInput}
          onComplete={handleScanComplete}
          onCancel={() => setScanInput(null)}
        />
      )}

      <ConfirmationModal
        visible={forgetCardTarget !== null}
        title={t("forget_memcard_card_title")}
        descriptionText={t("forget_memcard_card_description", {
          name: forgetCardTarget?.cardLabel ?? "",
        })}
        confirmButtonLabel={t("forget_memcard_card_confirm")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleForgetCard}
        onClose={() => setForgetCardTarget(null)}
      />
    </>
  );
}
