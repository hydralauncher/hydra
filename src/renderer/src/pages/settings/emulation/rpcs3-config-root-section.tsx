import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig, Rpcs3ConfigRootStatus } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";

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
  return (
    <>
      <EmulatorResourceRow
        title={t("rpcs3_config_title")}
        description={t(`rpcs3_config_${state}`)}
        detected={state === "ready"}
        statusLabel={
          state === "ready" ? t("rpcs3_config_ready") : t("not_detected")
        }
        path={{
          text: status?.resolvedRoot ?? status?.selectedRoot ?? null,
          placeholder: t("rpcs3_config_no_folder"),
          onClick: browse,
          disabled: disabled || busy || !config.executablePath,
          title: t("rpcs3_config_browse"),
        }}
        actions={
          <Button
            theme="primary"
            onClick={browse}
            disabled={disabled || busy || !config.executablePath}
          >
            <FileDirectoryIcon size={16} />
            <span>{t("rpcs3_config_browse")}</span>
          </Button>
        }
      />
      {status && status.candidates.length > 1 && (
        <section className="emulator-detail__section">
          <header className="emulator-detail__section-header">
            <div className="emulator-detail__section-text">
              <h3>{t("rpcs3_config_candidates")}</h3>
            </div>
          </header>
          {status.candidates.map((candidate) => (
            <div className="emulator-detail__exec-path-row" key={candidate}>
              <button
                type="button"
                className="emulator-detail__exec-path-box"
                onClick={() => void select(candidate)}
                disabled={disabled || busy}
              >
                <span
                  className="emulator-detail__exec-path-text"
                  title={candidate}
                >
                  {candidate}
                </span>
              </button>
              <div className="emulator-detail__exec-actions">
                <Button
                  theme="outline"
                  onClick={() => void select(candidate)}
                  disabled={disabled || busy}
                >
                  {t("rpcs3_config_select")}
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
