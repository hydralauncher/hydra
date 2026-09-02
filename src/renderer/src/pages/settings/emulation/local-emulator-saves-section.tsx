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
import pspArtwork from "@renderer/assets/emulation/psp.png";
import gamecubeArtwork from "@renderer/assets/emulation/gamecube.png";
import wiiArtwork from "@renderer/assets/emulation/wii.png";
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

const mockSave = (
  platform: LocalSaveItem["platform"],
  values: Pick<
    MemoryCardSaveRecord,
    | "folderName"
    | "sku"
    | "title"
    | "cardLabel"
    | "libraryImageUrl"
    | "fileCount"
    | "sizeBytes"
  >
): LocalSaveItem => {
  const timestamp = new Date("2026-09-01T18:30:00Z").getTime();
  return {
    platform,
    save: {
      cardFilePath: `mock://${platform}/${values.folderName}`,
      objectId: `mock-${platform}-${values.sku}`,
      shop: "launchbox",
      iconUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      createdAt: timestamp - 7 * 24 * 60 * 60 * 1_000,
      modifiedAt: timestamp,
      detectedAt: timestamp,
      ...values,
    },
  };
};

const MOCK_LOCAL_SAVES: LocalSaveItem[] = [
  mockSave("psp", {
    folderName: "ULUS105670000",
    sku: "ULUS10567",
    title: "God of War: Ghost of Sparta",
    cardLabel: "PPSSPP savedata",
    libraryImageUrl: pspArtwork,
    fileCount: 5,
    sizeBytes: 3_840_512,
  }),
  mockSave("psp", {
    folderName: "ULUS105120001",
    sku: "ULUS10512",
    title: "Persona 3 Portable",
    cardLabel: "PPSSPP savedata",
    libraryImageUrl: pspArtwork,
    fileCount: 8,
    sizeBytes: 6_291_456,
  }),
  mockSave("gamecube", {
    folderName: "A:USA:GM8E01:gczelda",
    sku: "GM8E01",
    title: "Metroid Prime",
    cardLabel: "GameCube · USA · Card A",
    libraryImageUrl: gamecubeArtwork,
    fileCount: 1,
    sizeBytes: 73_728,
  }),
  mockSave("gamecube", {
    folderName: "B:EUR:GZLP01:zelda",
    sku: "GZLP01",
    title: "The Legend of Zelda: The Wind Waker",
    cardLabel: "GameCube · EUR · Card B",
    libraryImageUrl: gamecubeArtwork,
    fileCount: 1,
    sizeBytes: 147_456,
  }),
  mockSave("wii", {
    folderName: "00010000524d4345",
    sku: "RMCE01",
    title: "Mario Kart Wii",
    cardLabel: "Wii · NAND",
    libraryImageUrl: wiiArtwork,
    fileCount: 3,
    sizeBytes: 8_912_896,
  }),
  mockSave("wii", {
    folderName: "00010000525a4445",
    sku: "RZDE01",
    title: "The Legend of Zelda: Twilight Princess",
    cardLabel: "Wii · NAND",
    libraryImageUrl: wiiArtwork,
    fileCount: 4,
    sizeBytes: 11_534_336,
  }),
];

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
      const discovered = groups.flat();
      const previews = import.meta.env.DEV
        ? MOCK_LOCAL_SAVES.filter((save) => platforms.includes(save.platform))
        : [];
      setSaves([...previews, ...discovered]);
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
        if (import.meta.env.DEV && save.cardFilePath.startsWith("mock://")) {
          showSuccessToast(t("cloud_backup_success"));
          return;
        }
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
