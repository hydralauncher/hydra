import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon } from "@primer/octicons-react";

import { Button, SelectField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig, Rpcs3ConfigRootStatus } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";
import { getRpcs3ConfigRootChoices } from "./rpcs3-config-root-choices";

interface Props {
  config: EmulatorConfig;
  disabled: boolean;
  onChange: (config: EmulatorConfig) => void;
}

export function Rpcs3ConfigRootSection({
  config,
  disabled,
  onChange,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showErrorToast } = useToast();
  const [status, setStatus] = useState<Rpcs3ConfigRootStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.electron
      .getRpcs3ConfigRootStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
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
      showErrorToast(t("rpcs3_config_invalid_selection"));
      setStatus(
        await window.electron.getRpcs3ConfigRootStatus().catch(() => null)
      );
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
  const { selectedRoot, roots } = getRpcs3ConfigRootChoices(status);
  const controlsDisabled = disabled || busy || !config.executablePath;

  return (
    <EmulatorResourceRow
      title={t("rpcs3_config_title")}
      description={t(`rpcs3_config_${state}`)}
      detected={state === "ready"}
      statusLabel={
        state === "ready" ? t("rpcs3_config_ready") : t("not_detected")
      }
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
                    label: t("rpcs3_config_no_folder"),
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
          <span>{t("rpcs3_config_browse")}</span>
        </Button>
      }
    />
  );
}
