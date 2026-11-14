import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";
import { firmwareGuideUrl } from "./setup/ps-firmware-url";

interface FirmwareSectionProps {
  config: EmulatorConfig;
  disabled: boolean;
}

export function FirmwareSection({
  config,
  disabled,
}: Readonly<FirmwareSectionProps>) {
  const { t, i18n } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const isPs4 = config.system === "ps4";

  const probe = useCallback(async () => {
    setChecking(true);
    try {
      const result = await globalThis.window.electron.checkEmulatorFirmware(
        config.system,
        config.executablePath
      );
      setInstalled(result.installed);
      setFirmwarePath(result.path);
      return result.installed;
    } finally {
      setChecking(false);
    }
  }, [config.system, config.executablePath]);

  useEffect(() => {
    probe().catch(() => {});
  }, [probe]);

  const handleRedetect = useCallback(async () => {
    const found = await probe();
    if (found) showSuccessToast(t("setup_firmware_found"));
    else if (!isPs4) showErrorToast(t("setup_firmware_not_yet"));
  }, [isPs4, probe, showSuccessToast, showErrorToast, t]);

  const missingStatusLabel = t(
    isPs4 ? "firmware_status_optional" : "not_detected"
  );

  return (
    <EmulatorResourceRow
      title={t("firmware_section_title")}
      description={t(
        isPs4
          ? "firmware_section_description_ps4"
          : "firmware_section_description"
      )}
      detected={isPs4 || !!installed}
      statusLabel={installed ? t("setup_firmware_found") : missingStatusLabel}
      path={{
        text: firmwarePath,
        placeholder: t("setup_firmware_not_yet"),
        disabled: !firmwarePath,
        title: firmwarePath ?? undefined,
        onClick: () => {
          if (firmwarePath)
            void globalThis.window.electron.openFolder(firmwarePath);
        },
      }}
      headerAccessory={
        <button
          type="button"
          className="emulator-detail__res-link"
          onClick={() =>
            void globalThis.window.electron.openExternal(
              firmwareGuideUrl(config.system, i18n.language)
            )
          }
        >
          <LinkExternalIcon size={12} />
          <span>
            {t(isPs4 ? "firmware_guide_link" : "firmware_official_link")}
          </span>
        </button>
      }
      actions={
        <Button
          theme="outline"
          onClick={handleRedetect}
          disabled={disabled || checking}
        >
          <SyncIcon
            size={13}
            className={
              checking ? "emulator-detail__redetect-icon--spinning" : undefined
            }
          />
          <span>{t("re_detect")}</span>
        </Button>
      }
    />
  );
}
