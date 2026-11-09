import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";
import { SHADPS4_QUICK_START_URL } from "./setup/ps-firmware-url";

interface TrophyKeySectionProps {
  config: EmulatorConfig;
  disabled: boolean;
}

export function TrophyKeySection({
  config,
  disabled,
}: Readonly<TrophyKeySectionProps>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [installed, setInstalled] = useState(false);
  const [keyFolder, setKeyFolder] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const probe = useCallback(async () => {
    setChecking(true);
    try {
      const result = await globalThis.window.electron.checkShadps4TrophyKey(
        config.executablePath
      );
      setInstalled(result.installed);
      setKeyFolder(result.path);
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
    if (found) showSuccessToast(t("trophy_key_found"));
    else showErrorToast(t("trophy_key_not_found"));
  }, [probe, showSuccessToast, showErrorToast, t]);

  return (
    <EmulatorResourceRow
      title={t("trophy_key_section_title")}
      description={t("trophy_key_section_description")}
      detected={installed}
      statusLabel={installed ? t("trophy_key_found") : t("not_detected")}
      path={{
        text: keyFolder,
        placeholder: t("trophy_key_not_found"),
        disabled: !keyFolder,
        title: keyFolder ?? undefined,
        onClick: () => {
          if (keyFolder) void globalThis.window.electron.openFolder(keyFolder);
        },
      }}
      headerAccessory={
        <button
          type="button"
          className="emulator-detail__res-link"
          onClick={() =>
            void globalThis.window.electron.openExternal(
              SHADPS4_QUICK_START_URL
            )
          }
        >
          <LinkExternalIcon size={12} />
          <span>{t("firmware_guide_link")}</span>
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
