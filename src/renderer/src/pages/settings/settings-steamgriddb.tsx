import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { SgdbSettings } from "@types";

import "./settings-debrid.scss";
import "./settings-steamgriddb.scss";

const STEAMGRIDDB_URL = "https://www.steamgriddb.com";
const STEAMGRIDDB_API_KEY_URL =
  "https://www.steamgriddb.com/profile/preferences/api";

const CHEVRON_ICON_SIZE = 16;

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
  const [isCollapsed, setIsCollapsed] = useState(
    () => !userPreferences?.steamGridDbApiKey
  );
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
  const isConfigured = hasSavedKey && settings.enabled;

  return (
    <div
      className={`settings-debrid__section ${
        isCollapsed ? "" : "settings-debrid__section--expanded"
      }`}
    >
      <div className="settings-debrid__section-header">
        <button
          type="button"
          className="settings-debrid__collapse-button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          aria-label={
            isCollapsed
              ? t("expand_debrid_section", { provider: t("steamgriddb_title") })
              : t("collapse_debrid_section", {
                  provider: t("steamgriddb_title"),
                })
          }
        >
          <span
            className={`settings-debrid__collapse-icon ${
              isCollapsed ? "" : "settings-debrid__collapse-icon--expanded"
            }`}
          >
            <ChevronRightIcon size={CHEVRON_ICON_SIZE} />
          </span>
        </button>
        <h3 className="settings-debrid__section-title">
          {t("steamgriddb_title")}
        </h3>
        {isConfigured && (
          <CheckCircleFillIcon
            size={CHEVRON_ICON_SIZE}
            className="settings-debrid__check-icon"
          />
        )}
      </div>

      {!isCollapsed && (
        <div className="settings-steamgriddb__body">
          <p className="settings-steamgriddb__description">
            {t("steamgriddb_description")}
          </p>

          <Link to={STEAMGRIDDB_URL} className="settings-steamgriddb__link">
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

          {SHOPS.map((shop) => (
            <div key={shop.key} className="settings-steamgriddb__shop">
              <h4 className="settings-steamgriddb__shop-title">
                {t(shop.labelKey)}
              </h4>

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
                  disabled={
                    controlsDisabled || !settings.matrix[shop.key].enabled
                  }
                  onChange={() => toggleMatrix(shop.key, asset.key)}
                />
              ))}
            </div>
          ))}

          <Button
            type="button"
            theme="outline"
            disabled={controlsDisabled}
            onClick={handleRefresh}
          >
            {t("steamgriddb_refresh")}
          </Button>
        </div>
      )}
    </div>
  );
}
