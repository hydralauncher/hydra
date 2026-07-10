import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { LinkExternalIcon } from "@primer/octicons-react";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { SgdbSettings } from "@types";

const STEAMGRIDDB_URL = "https://www.steamgriddb.com";
const STEAMGRIDDB_API_KEY_URL =
  "https://www.steamgriddb.com/profile/preferences/api";

type ShopKey = "steam" | "launchbox";
type AssetKey = "grid" | "hero" | "logo" | "icon";
type MatrixKey = keyof SgdbSettings["matrix"]["steam"];

const SHOPS: { key: ShopKey; labelKey: string }[] = [
  { key: "steam", labelKey: "steamgriddb_shop_steam" },
  { key: "launchbox", labelKey: "steamgriddb_shop_launchbox" },
];

const ASSET_TYPES: { key: AssetKey; labelKey: string }[] = [
  { key: "grid", labelKey: "steamgriddb_asset_grid" },
  { key: "hero", labelKey: "steamgriddb_asset_hero" },
  { key: "logo", labelKey: "steamgriddb_asset_logo" },
  { key: "icon", labelKey: "steamgriddb_asset_icon" },
];

const buildDefaultMatrix = (): SgdbSettings["matrix"] => ({
  steam: { enabled: true, grid: true, hero: true, logo: true, icon: true },
  launchbox: { enabled: true, grid: true, hero: true, logo: true, icon: true },
});

export function SettingsSteamGridDb() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [settings, setSettings] = useState<SgdbSettings>({
    enabled: false,
    cacheImages: false,
    matrix: buildDefaultMatrix(),
  });

  useEffect(() => {
    if (!userPreferences) return;

    setApiKey(userPreferences.steamGridDbApiKey ?? "");
    setHasSavedKey(Boolean(userPreferences.steamGridDbApiKey));
    setSettings({
      enabled: userPreferences.steamGridDb?.enabled ?? false,
      cacheImages: userPreferences.steamGridDb?.cacheImages ?? false,
      matrix: userPreferences.steamGridDb?.matrix ?? buildDefaultMatrix(),
    });
  }, [userPreferences]);

  const persist = async (next: SgdbSettings, triggerMatch: boolean) => {
    setSettings(next);
    await updateUserPreferences({ steamGridDb: next });

    if (triggerMatch && next.enabled && hasSavedKey) {
      window.electron.runSteamGridDbAutoMatch({});
    }
  };

  const handleSaveKey: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      await window.electron.authenticateSteamGridDb(apiKey);
      await updateUserPreferences({ steamGridDbApiKey: apiKey || null });
      setHasSavedKey(Boolean(apiKey));
      showSuccessToast(
        apiKey ? t("steamgriddb_key_saved") : t("changes_saved")
      );

      if (apiKey && settings.enabled) {
        window.electron.runSteamGridDbAutoMatch({});
      }
    } catch {
      showErrorToast(t("steamgriddb_invalid_key"));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleEnabled = () => {
    const enabled = !settings.enabled;
    void persist({ ...settings, enabled }, enabled);
  };

  const toggleCacheImages = () => {
    const cacheImages = !settings.cacheImages;
    void persist({ ...settings, cacheImages }, false).then(() => {
      if (cacheImages && settings.enabled && hasSavedKey) {
        window.electron.runSteamGridDbAutoMatch({ forceFresh: true });
      }
    });
  };

  const toggleMatrix = (shop: ShopKey, key: MatrixKey) => {
    const value = !settings.matrix[shop][key];
    const next: SgdbSettings = {
      ...settings,
      matrix: {
        ...settings.matrix,
        [shop]: { ...settings.matrix[shop], [key]: value },
      },
    };
    void persist(next, value);
  };

  const handleRefresh = () => {
    window.electron.runSteamGridDbAutoMatch({ forceFresh: true });
    showSuccessToast(t("steamgriddb_refresh_started"));
  };

  const controlsDisabled = !hasSavedKey || !settings.enabled;
  const isKeyButtonDisabled = isLoading || (!apiKey && !hasSavedKey);

  return (
    <>
      <div className="settings-context-panel__group">
        <h3>{t("steamgriddb_title")}</h3>

        <p>{t("steamgriddb_description")}</p>

        <Link to={STEAMGRIDDB_URL}>
          <LinkExternalIcon />
          {t("steamgriddb_visit")}
        </Link>

        <form onSubmit={handleSaveKey}>
          <TextField
            label={t("steamgriddb_api_key")}
            value={apiKey}
            type="password"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t("steamgriddb_api_key")}
            rightContent={
              <Button type="submit" disabled={isKeyButtonDisabled}>
                {t("save_changes")}
              </Button>
            }
            hint={
              <Trans i18nKey="steamgriddb_api_key_hint" ns="settings">
                <Link to={STEAMGRIDDB_API_KEY_URL} />
              </Trans>
            }
          />
        </form>

        <CheckboxField
          label={t("steamgriddb_enable")}
          checked={settings.enabled}
          disabled={!hasSavedKey}
          onChange={toggleEnabled}
        />

        <CheckboxField
          label={t("steamgriddb_cache_images")}
          checked={settings.cacheImages}
          disabled={controlsDisabled}
          onChange={toggleCacheImages}
        />
      </div>

      {SHOPS.map((shop) => (
        <div key={shop.key} className="settings-context-panel__group">
          <h3>{t(shop.labelKey)}</h3>

          <CheckboxField
            label={t("steamgriddb_shop_enable")}
            checked={settings.matrix[shop.key].enabled}
            disabled={controlsDisabled}
            onChange={() => toggleMatrix(shop.key, "enabled")}
          />

          {ASSET_TYPES.map((asset) => (
            <CheckboxField
              key={asset.key}
              label={t(asset.labelKey)}
              checked={settings.matrix[shop.key][asset.key]}
              disabled={controlsDisabled || !settings.matrix[shop.key].enabled}
              onChange={() => toggleMatrix(shop.key, asset.key)}
            />
          ))}
        </div>
      ))}

      <div className="settings-context-panel__group">
        <Button
          type="button"
          theme="outline"
          disabled={controlsDisabled}
          onClick={handleRefresh}
        >
          {t("steamgriddb_refresh")}
        </Button>
      </div>
    </>
  );
}
