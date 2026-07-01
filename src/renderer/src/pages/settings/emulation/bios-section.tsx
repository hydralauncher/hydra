import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon, SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";
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
  const { showSuccessToast, showErrorToast } = useToast();
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
        if (result.detectedPath && result.detectedPath !== config.biosPath) {
          onChange({ ...config, biosPath: result.detectedPath });
        }
        return result.installed;
      } finally {
        setChecking(false);
      }
    },
    [config, onChange]
  );

  useEffect(() => {
    probe().catch(() => {});
  }, [probe]);

  const handleRedetect = useCallback(async () => {
    const found = await probe();
    if (found) showSuccessToast(t("setup_bios_found"));
    else showErrorToast(t("setup_bios_not_yet"));
  }, [probe, showSuccessToast, showErrorToast, t]);

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

  const effectivePath = detectedPath ?? config.biosPath;
  const controlsDisabled = disabled || busy;

  return (
    <EmulatorResourceRow
      title={t("bios_section_title")}
      description={t("bios_section_description", { name: binaryName })}
      detected={!!installed}
      statusLabel={installed ? t("setup_bios_found") : t("not_detected")}
      path={{
        text: effectivePath,
        placeholder: t("bios_folder_none"),
        onClick: handleBrowse,
        disabled: controlsDisabled,
        title: t("setup_bios_select_folder"),
      }}
      actions={
        <>
          <Button
            theme="outline"
            onClick={handleRedetect}
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
            <span>{t("re_detect")}</span>
          </Button>
          <Button
            theme="primary"
            onClick={handleBrowse}
            disabled={controlsDisabled}
          >
            <FileDirectoryIcon size={16} />
            <span>{t("browse")}</span>
          </Button>
        </>
      }
    />
  );
}
