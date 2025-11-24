import { useTranslation } from "react-i18next";
import { CheckboxField, SelectField, TextField } from "@renderer/components";
import type { LibraryGame } from "@types";
import { useContext, useEffect, useState } from "react";
import { gameDetailsContext } from "@renderer/context";
import { ProtonDBBadge } from "./protondb-badge";
import "./linux-compatibility-tab.scss";

interface Runner {
  path: string;
  name: string;
}

export interface LinuxCompatibilityTabProps {
  game: LibraryGame;
}

import { debounce } from "lodash-es";

export function LinuxCompatibilityTab({
  game,
}: Readonly<LinuxCompatibilityTabProps>) {
  const { t } = useTranslation("game_details");

  const { updateGame } = useContext(gameDetailsContext);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [selectedRunner, setSelectedRunner] = useState<string | null>(
    game.linux?.runnerPath || null
  );
  const [launchOptions, setLaunchOptions] = useState(
    game.linux?.arguments || ""
  );
  const [envVars, setEnvVars] = useState(game.linux?.envVars || {});

  useEffect(() => {
    window.electron.discoverProtonRunners().then(setRunners);
  }, []);

  const debouncedUpdate = debounce(async (linuxConfig) => {
    await window.electron.updateGameLinuxConfig(
      game.shop,
      game.objectId,
      linuxConfig
    );
    updateGame();
  }, 1000);

  const handleRunnerChange = (value: string) => {
    setSelectedRunner(value);
    debouncedUpdate({ ...game.linux, runnerPath: value });
  };

  const handleLaunchOptionsChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setLaunchOptions(event.target.value);
    debouncedUpdate({ ...game.linux, arguments: event.target.value });
  };

  const handleEnvVarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = event.target;
    const newEnvVars = { ...envVars, [name]: checked ? "1" : "0" };
    setEnvVars(newEnvVars);
    debouncedUpdate({ ...game.linux, envVars: newEnvVars });
  };

  return (
    <div className="linux-compatibility-tab__section">
      <div className="linux-compatibility-tab__header">
        <h2>{t("linux_compatibility")}</h2>
        <h4 className="linux-compatibility-tab__header-description">
          {t("linux_compatibility_description")}
        </h4>
      </div>

      <div className="linux-compatibility-tab__row">
        <SelectField
          label={t("proton_runner")}
          value={selectedRunner || ""}
          onChange={(e) => handleRunnerChange(e.target.value)}
          options={runners.map((runner) => ({
            key: runner.path,
            label: runner.name,
            value: runner.path,
          }))}
        />
        <ProtonDBBadge appId={Number(game.remoteId)} />
      </div>

      <div className="linux-compatibility-tab__launch-options">
        <TextField
          label={t("launch_options")}
          placeholder={t("launch_options_placeholder")}
          value={launchOptions}
          onChange={handleLaunchOptionsChange}
        />
      </div>

      <div className="linux-compatibility-tab__row">
        <CheckboxField
          label="DXVK_HUD"
          name="DXVK_HUD"
          checked={envVars["DXVK_HUD"] === "1"}
          onChange={handleEnvVarChange}
        />
        <CheckboxField
          label="VKD3D_CONFIG"
          name="VKD3D_CONFIG"
          checked={envVars["VKD3D_CONFIG"] === "1"}
          onChange={handleEnvVarChange}
        />
        <CheckboxField
          label="MANGOHUD"
          name="MANGOHUD"
          checked={envVars["MANGOHUD"] === "1"}
          onChange={handleEnvVarChange}
        />
        <CheckboxField
          label="GAMEMODERUN"
          name="GAMEMODERUN"
          checked={envVars["GAMEMODERUN"] === "1"}
          onChange={handleEnvVarChange}
        />
      </div>
    </div>
  );
}
