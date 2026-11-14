import { FileDirectoryIcon } from "@primer/octicons-react";
import type { EmulatorConfig, EmulatorSaveLocationStatus } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { EmulatorSaveLocation } from "@renderer/pages/settings/emulation/emulator-save-location";
import { getEmulatorSaveLocationChoices } from "@renderer/pages/settings/emulation/emulator-save-location-choices";
import { Button, VerticalFocusGroup } from "../../../components";
import { useBigPictureToast } from "../../../hooks";
import { EMULATION_DETAIL_SAVE_LOCATION_BROWSE_BUTTON_ID } from "../settings-navigation";
import { SETTINGS_TOAST_OPTIONS } from "./shared";

interface Props {
  config: EmulatorConfig;
  location: EmulatorSaveLocation;
  onChange: (config: EmulatorConfig) => void;
}

export function EmulatorSaveLocationSection({
  config,
  location,
  onChange,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showErrorToast } = useBigPictureToast();
  const [status, setStatus] = useState<
    EmulatorSaveLocationStatus | "checking" | "error"
  >("checking");
  const [busy, setBusy] = useState(false);
  const key = (suffix: string) => `${location.keyPrefix}_${suffix}`;
  const selectedDir = location.selectedDir(config);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    void location
      .getStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [config.executablePath, selectedDir, location]);

  const select = async (root: string) => {
    setBusy(true);
    try {
      const next = await location.select(root);
      onChange(next);
      setStatus(await location.getStatus());
    } catch {
      showErrorToast(t(key("invalid_selection")), SETTINGS_TOAST_OPTIONS);
      setStatus(await location.getStatus().catch(() => "error" as const));
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
      showErrorToast(t(key("error")), SETTINGS_TOAST_OPTIONS);
    }
  };

  const rootStatus = typeof status === "object" ? status : null;
  const { selectedRoot, roots } = getEmulatorSaveLocationChoices(rootStatus);
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
            <h3>{t(key("title"))}</h3>
          </div>
          <p>{t(key(statusKey))}</p>
        </div>
      </header>

      <VerticalFocusGroup
        regionId="emulation-detail-save-location-roots"
        className="emulator-detail__save-location-roots"
      >
        {roots.map((root, index) => (
          <div className="emulator-detail__row" key={root}>
            <span className="emulator-detail__save-location-path" title={root}>
              {root}
            </span>
            <Button
              focusId={`emulation-detail-save-location-${index}`}
              variant="secondary"
              disabled={
                controlsDisabled ||
                (root === selectedRoot && rootStatus?.status === "ready")
              }
              onClick={() => void select(root)}
            >
              {root === selectedRoot && rootStatus?.status === "ready"
                ? t(key("ready"))
                : t("select")}
            </Button>
          </div>
        ))}
        <Button
          focusId={EMULATION_DETAIL_SAVE_LOCATION_BROWSE_BUTTON_ID}
          variant="secondary"
          icon={<FileDirectoryIcon size={16} />}
          disabled={controlsDisabled}
          onClick={() => void browse()}
        >
          {t(key("browse"))}
        </Button>
      </VerticalFocusGroup>
    </section>
  );
}
