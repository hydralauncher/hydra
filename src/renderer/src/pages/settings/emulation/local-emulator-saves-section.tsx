import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KebabHorizontalIcon,
  QuestionIcon,
  SyncIcon,
  UploadIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { getSkuRegion, getSkuRegionFlag } from "@renderer/helpers";
import { useToast, useUserDetails } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type {
  EmulationSavePlatform,
  EmulatorConfig,
  MemoryCardSaveRecord,
} from "@types";

interface Props {
  config: EmulatorConfig;
  onUploaded: () => void;
}

const saveKey = (save: MemoryCardSaveRecord): string =>
  `${save.cardFilePath}::${save.folderName}`;

const localSavePlatforms = (
  system: EmulatorConfig["system"]
): Array<Extract<EmulationSavePlatform, "psp" | "gamecube" | "wii">> =>
  system === "psp" ? ["psp"] : ["gamecube", "wii"];

interface LocalSaveItem {
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube" | "wii">;
  save: MemoryCardSaveRecord;
}

const localSaveKey = ({ platform, save }: LocalSaveItem): string =>
  `${platform}::${saveKey(save)}`;

export function LocalEmulatorSavesSection({
  config,
  onUploaded,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const platforms = useMemo(
    () => localSavePlatforms(config.system),
    [config.system]
  );

  const [saves, setSaves] = useState<LocalSaveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [backingUpKey, setBackingUpKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const groups = await Promise.all(
        platforms.map(async (platform) =>
          (await window.electron.listLocalEmulationSaves(platform)).map(
            (save) => ({ platform, save })
          )
        )
      );
      setSaves(groups.flat());
    } finally {
      setLoading(false);
    }
  }, [platforms]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleBackup = useCallback(
    async ({ platform, save }: LocalSaveItem) => {
      const key = `${platform}::${saveKey(save)}`;
      setBackingUpKey(key);
      try {
        await window.electron.uploadEmulationSave(
          platform,
          save.cardFilePath,
          save.folderName
        );
        showSuccessToast(t("cloud_backup_success"));
        onUploaded();
      } catch {
        showErrorToast(t("cloud_backup_failed"));
      } finally {
        setBackingUpKey(null);
      }
    },
    [onUploaded, showErrorToast, showSuccessToast, t]
  );

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <h3>{t("local_emulator_saves_section_title")}</h3>
          <p>{t("local_emulator_saves_section_description")}</p>
        </div>
        <div className="emulator-detail__section-actions">
          <Button theme="outline" onClick={load} disabled={loading}>
            <SyncIcon
              size={13}
              className={
                loading ? "emulator-detail__redetect-icon--spinning" : ""
              }
            />
            <span>{t("cloud_refresh")}</span>
          </Button>
        </div>
      </header>

      {saves.length === 0 ? (
        <p className="emulator-detail__empty">{t("no_local_emulator_saves")}</p>
      ) : (
        <div className="emulator-detail__memcard-grid">
          {saves.map((item) => {
            const { platform, save } = item;
            const key = localSaveKey(item);
            const cover = save.libraryImageUrl ?? save.iconUrl;
            const title = save.title ?? save.folderName;
            const region = save.sku ? getSkuRegion(save.sku) : null;
            const backingUp = backingUpKey === key;
            const mapped = save.objectId !== null;
            const metadata = [
              platform === "psp" ? null : save.cardLabel,
              formatBytes(save.sizeBytes),
              t(
                save.fileCount === 1
                  ? "memcard_files_count_one"
                  : "memcard_files_count_other",
                { count: save.fileCount }
              ),
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div key={key} className="emulator-detail__memcard-card">
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
                    {!mapped && ` · ${t("setup_match_unmatched")}`}
                  </span>
                  <span
                    className="emulator-detail__memcard-meta"
                    title={save.cardFilePath}
                  >
                    {metadata}
                  </span>
                </div>

                {hasActiveSubscription && (
                  <DropdownMenu
                    align="end"
                    items={[
                      {
                        icon: <UploadIcon size={16} />,
                        label: backingUp
                          ? t("cloud_backing_up")
                          : t("cloud_backup"),
                        disabled: backingUp || !mapped,
                        onClick: () => handleBackup(item),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      className="emulator-detail__memcard-menu"
                      aria-label={title}
                    >
                      <KebabHorizontalIcon size={16} />
                    </button>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
