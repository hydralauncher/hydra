import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";
import { firmwarePageUrl } from "./setup/ps-firmware-url";

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
  const [checking, setChecking] = useState(false);

  const probe = useCallback(async () => {
    setChecking(true);
    try {
      const result = await globalThis.window.electron.checkPs3Firmware(
        config.executablePath
      );
      setInstalled(result.installed);
      return result.installed;
    } finally {
      setChecking(false);
    }
  }, [config.executablePath]);

  useEffect(() => {
    probe().catch(() => {});
  }, [probe]);

  const handleRedetect = useCallback(async () => {
    const found = await probe();
    if (found) showSuccessToast(t("setup_firmware_found"));
    else showErrorToast(t("setup_firmware_not_yet"));
  }, [probe, showSuccessToast, showErrorToast, t]);

  return (
    <EmulatorResourceRow
      title={t("firmware_section_title")}
      description={t("firmware_section_description")}
      detected={!!installed}
      statusLabel={installed ? t("setup_firmware_found") : t("not_detected")}
      headerAccessory={
        <button
          type="button"
          className="emulator-detail__res-link"
          onClick={() =>
            void globalThis.window.electron.openExternal(
              firmwarePageUrl(i18n.language)
            )
          }
        >
          <LinkExternalIcon size={12} />
          <span>{t("firmware_official_link")}</span>
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
