import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon } from "@primer/octicons-react";

import { Button, SelectField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig, EmulatorSaveLocationStatus } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";
import type { EmulatorSaveLocation } from "./emulator-save-location";
import { getEmulatorSaveLocationChoices } from "./emulator-save-location-choices";

interface Props {
  config: EmulatorConfig;
  location: EmulatorSaveLocation;
  disabled: boolean;
  onChange: (config: EmulatorConfig) => void;
}

export function EmulatorSaveLocationSection({
  config,
  location,
  disabled,
  onChange,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showErrorToast } = useToast();
  const [status, setStatus] = useState<EmulatorSaveLocationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const key = (suffix: string) => `${location.keyPrefix}_${suffix}`;
  const selectedDir = location.selectedDir(config);

  useEffect(() => {
    let cancelled = false;
    void location
      .getStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
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
      showErrorToast(t(key("invalid_selection")));
      setStatus(await location.getStatus().catch(() => null));
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: status?.selectedRoot ?? status?.resolvedRoot ?? undefined,
    });
    if (!result.canceled && result.filePaths[0])
      await select(result.filePaths[0]);
  };

  const state = status?.status ?? "not-configured";
  const { selectedRoot, roots } = getEmulatorSaveLocationChoices(status);
  const controlsDisabled = disabled || busy || !config.executablePath;

  if (!status || (state === "ready" && roots.length <= 1)) return null;

  return (
    <EmulatorResourceRow
      title={t(key("title"))}
      description={state === "ready" ? t(key("description")) : t(key(state))}
      detected={state === "ready"}
      statusLabel={state === "ready" ? t(key("ready")) : t("not_detected")}
      pathContent={
        <SelectField
          className="emulator-detail__config-root-select"
          value={selectedRoot}
          onChange={(event) => void select(event.target.value)}
          disabled={controlsDisabled || roots.length === 0}
          options={[
            ...(!selectedRoot
              ? [
                  {
                    key: "empty",
                    value: "",
                    label: t(key("no_folder")),
                  },
                ]
              : []),
            ...roots.map((root) => ({ key: root, value: root, label: root })),
          ]}
        />
      }
      actions={
        <Button theme="primary" onClick={browse} disabled={controlsDisabled}>
          <FileDirectoryIcon size={16} />
          <span>{t(key("browse"))}</span>
        </Button>
      }
    />
  );
}
