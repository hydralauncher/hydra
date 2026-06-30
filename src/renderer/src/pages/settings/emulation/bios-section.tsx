import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  ClockIcon,
  FileDirectoryIcon,
  SyncIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import type { EmulatorConfig } from "@types";

import { KNOWN_BINARY_LABELS } from "./known-binary-labels";

interface BiosSectionProps {
  config: EmulatorConfig;
  disabled: boolean;
  onChange: (config: EmulatorConfig) => void;
}

export function BiosSection({
  config,
  disabled,
  onChange,
}: Readonly<BiosSectionProps>) {
  const { t } = useTranslation("settings");
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [detectedPath, setDetectedPath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  const binaryName = KNOWN_BINARY_LABELS[config.binary];

  const probe = useCallback(
    async (overridePath: string | null = config.biosPath) => {
      setChecking(true);
      try {
        const result = await globalThis.window.electron.checkEmulatorBios(
          config.system,
          config.executablePath,
          overridePath
        );
        setInstalled(result.installed);
        setDetectedPath(result.detectedPath);
      } finally {
        setChecking(false);
      }
    },
    [config.system, config.executablePath, config.biosPath]
  );

  useEffect(() => {
    probe().catch(() => {});
  }, [probe]);

  const handleBrowse = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: config.biosPath ?? undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;

    setBusy(true);
    try {
      const next = await globalThis.window.electron.setEmulatorBiosPath(
        config.system,
        result.filePaths[0]
      );
      onChange(next);
      await probe(next.biosPath);
    } finally {
      setBusy(false);
    }
  }, [config.system, config.biosPath, onChange, probe]);

  const effectivePath = config.biosPath ?? detectedPath;
  const controlsDisabled = disabled || busy;

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <h3>{t("bios_section_title")}</h3>
          <p>{t("bios_section_description", { name: binaryName })}</p>
        </div>
        <span className="emulator-detail__bios-status">
          {installed ? (
            <CheckCircleFillIcon size={14} />
          ) : (
            <ClockIcon size={14} />
          )}
          <span>
            {installed ? t("setup_bios_found") : t("setup_bios_not_yet")}
          </span>
        </span>
      </header>

      <div className="emulator-detail__exec-path-row">
        <button
          type="button"
          className="emulator-detail__exec-path-box"
          onClick={handleBrowse}
          disabled={controlsDisabled}
          title={t("setup_bios_select_folder")}
          aria-label={t("setup_bios_select_folder")}
        >
          <span
            className={`emulator-detail__exec-path-text${effectivePath ? "" : " emulator-detail__exec-path-text--placeholder"}`}
            title={effectivePath ?? undefined}
          >
            {effectivePath ?? t("bios_folder_none")}
          </span>
        </button>
        <div className="emulator-detail__exec-actions">
          <Button
            theme="outline"
            onClick={() => probe()}
            disabled={controlsDisabled || checking}
          >
            <SyncIcon
              size={13}
              className={
                checking
                  ? "emulator-detail__redetect-icon--spinning"
                  : undefined
              }
            />
            <span>{t("setup_bios_check_again")}</span>
          </Button>
          <Button
            theme="primary"
            onClick={handleBrowse}
            disabled={controlsDisabled}
          >
            <FileDirectoryIcon size={16} />
            <span>{t("setup_bios_select_folder")}</span>
          </Button>
        </div>
      </div>
    </section>
  );
}
