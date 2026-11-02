import { FileDirectoryIcon } from "@primer/octicons-react";
import type { EmulatorConfig, Rpcs3ConfigRootStatus } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getRpcs3ConfigRootChoices } from "@renderer/pages/settings/emulation/rpcs3-config-root-choices";
import { Button, VerticalFocusGroup } from "../../../components";
import { useBigPictureToast } from "../../../hooks";
import { EMULATION_DETAIL_RPCS3_ROOT_BROWSE_BUTTON_ID } from "../settings-navigation";
import { SETTINGS_TOAST_OPTIONS } from "./shared";

interface Props {
  config: EmulatorConfig;
  onChange: (config: EmulatorConfig) => void;
}

export function Rpcs3ConfigRootSection({ config, onChange }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showErrorToast } = useBigPictureToast();
  const [status, setStatus] = useState<
    Rpcs3ConfigRootStatus | "checking" | "error"
  >("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    void window.electron
      .getRpcs3ConfigRootStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [config.executablePath, config.rpcs3ConfigRoot]);

  const select = async (root: string) => {
    setBusy(true);
    try {
      const next = await window.electron.setRpcs3ConfigRoot(root);
      onChange(next);
      setStatus(await window.electron.getRpcs3ConfigRootStatus());
    } catch {
      showErrorToast(
        t("rpcs3_config_invalid_selection"),
        SETTINGS_TOAST_OPTIONS
      );
      setStatus(
        await window.electron
          .getRpcs3ConfigRootStatus()
          .catch(() => "error" as const)
      );
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    try {
      const result = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath:
          typeof status === "object"
            ? (status.selectedRoot ?? status.resolvedRoot ?? undefined)
            : undefined,
      });
      if (!result.canceled && result.filePaths[0])
        await select(result.filePaths[0]);
    } catch {
      showErrorToast(t("rpcs3_config_error"), SETTINGS_TOAST_OPTIONS);
    }
  };

  const rootStatus = typeof status === "object" ? status : null;
  const { selectedRoot, roots } = getRpcs3ConfigRootChoices(rootStatus);
  const controlsDisabled = busy || !config.executablePath;
  const statusKey = config.executablePath
    ? typeof status === "object"
      ? status.status
      : status
    : "not-configured";

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <div className="emulator-detail__section-title-row">
            <h3>{t("rpcs3_config_title")}</h3>
          </div>
          <p>{t(`rpcs3_config_${statusKey}`)}</p>
        </div>
      </header>

      <VerticalFocusGroup
        regionId="emulation-detail-rpcs3-config-roots"
        className="emulator-detail__rpcs3-roots"
      >
        {roots.map((root, index) => (
          <div className="emulator-detail__row" key={root}>
            <span className="emulator-detail__rpcs3-root-path" title={root}>
              {root}
            </span>
            <Button
              focusId={`emulation-detail-rpcs3-root-${index}`}
              variant="secondary"
              disabled={
                controlsDisabled ||
                (root === selectedRoot && rootStatus?.status === "ready")
              }
              onClick={() => void select(root)}
            >
              {t(
                root === selectedRoot && rootStatus?.status === "ready"
                  ? "rpcs3_config_ready"
                  : "select"
              )}
            </Button>
          </div>
        ))}
        <Button
          focusId={EMULATION_DETAIL_RPCS3_ROOT_BROWSE_BUTTON_ID}
          variant="secondary"
          icon={<FileDirectoryIcon size={16} />}
          disabled={controlsDisabled}
          onClick={() => void browse()}
        >
          {t("rpcs3_config_browse")}
        </Button>
      </VerticalFocusGroup>
    </section>
  );
}
