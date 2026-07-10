import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import type {
  LibraryGame,
  SgdbAsset,
  SgdbAssetType,
  SgdbOverride,
  SgdbSelectionRecord,
  SgdbVariantsCache,
} from "@types";

import "./game-steamgriddb-assets.scss";

const PLURAL: Record<SgdbAssetType, "grids" | "heroes" | "logos" | "icons"> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

const OVERRIDES: SgdbOverride[] = ["inherit", "on", "off"];

const SEARCH_DEBOUNCE_MS = 500;

interface GameSteamGridDbAssetsProps {
  game: LibraryGame;
  assetType: SgdbAssetType;
  onChanged: () => Promise<void> | void;
}

export function GameSteamGridDbAssets({
  game,
  assetType,
  onChanged,
}: Readonly<GameSteamGridDbAssetsProps>) {
  const { t } = useTranslation("sidebar");
  const { showErrorToast } = useToast();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const hasApiKey = Boolean(userPreferences?.steamGridDbApiKey);

  const [selection, setSelection] = useState<SgdbSelectionRecord | null>(null);
  const [variants, setVariants] = useState<SgdbVariantsCache | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [term, setTerm] = useState("");

  const loadSelection = useCallback(async () => {
    const record = await window.electron.getSteamGridDbSelection(
      game.shop,
      game.objectId
    );
    setSelection(record);
  }, [game.shop, game.objectId]);

  const loadVariants = useCallback(
    async (options?: { forceFresh?: boolean; term?: string }) => {
      if (!hasApiKey) return;

      setIsLoading(true);
      try {
        const result = await window.electron.getSteamGridDbVariants(
          game.shop,
          game.objectId,
          options
        );
        setVariants(result);
      } catch {
        showErrorToast(t("steamgriddb_fetch_failed"));
      } finally {
        setIsLoading(false);
      }
    },
    [game.shop, game.objectId, hasApiKey, showErrorToast, t]
  );

  useEffect(() => {
    void loadSelection();
  }, [loadSelection]);

  useEffect(() => {
    const trimmed = term.trim();

    if (!trimmed) {
      void loadVariants();
      return;
    }

    const handle = setTimeout(() => {
      void loadVariants({ term: trimmed });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [term, loadVariants]);

  const assets: SgdbAsset[] = variants?.[PLURAL[assetType]] ?? [];
  const currentAssetId = selection?.selected?.[assetType]?.assetId;

  const handlePick = async (asset: SgdbAsset) => {
    await window.electron.setSteamGridDbSelection({
      shop: game.shop,
      objectId: game.objectId,
      type: assetType,
      url: asset.url,
      assetId: asset.id,
    });
    await loadSelection();
    await onChanged();
  };

  const handleClear = async () => {
    await window.electron.setSteamGridDbSelection({
      shop: game.shop,
      objectId: game.objectId,
      type: assetType,
      clear: true,
    });
    await loadSelection();
    await onChanged();
  };

  const handleOverride = async (override: SgdbOverride) => {
    await window.electron.setSteamGridDbOverride(
      game.shop,
      game.objectId,
      override
    );
    await loadSelection();
    await onChanged();
    await loadVariants();
  };

  if (!hasApiKey) {
    return (
      <div className="game-steamgriddb__hint">
        {t("steamgriddb_no_api_key")}
      </div>
    );
  }

  return (
    <div className="game-steamgriddb">
      <div className="game-steamgriddb__header">
        <span className="game-steamgriddb__title">
          {t("steamgriddb_section_title")}
        </span>

        <div className="game-steamgriddb__override">
          {OVERRIDES.map((value) => (
            <Button
              key={value}
              type="button"
              theme={
                (selection?.override ?? "inherit") === value
                  ? "primary"
                  : "outline"
              }
              onClick={() => handleOverride(value)}
            >
              {t(`steamgriddb_override_${value}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="game-steamgriddb__actions">
        <TextField
          placeholder={t("steamgriddb_search_placeholder")}
          value={term}
          theme="dark"
          onChange={(event) => setTerm(event.target.value)}
        />
        <Button
          type="button"
          theme="outline"
          onClick={() => loadVariants({ forceFresh: true })}
          disabled={isLoading}
        >
          {t("steamgriddb_refresh")}
        </Button>
        <Button
          type="button"
          theme="outline"
          onClick={handleClear}
          disabled={isLoading}
        >
          {t("steamgriddb_use_default")}
        </Button>
      </div>

      {isLoading ? (
        <div className="game-steamgriddb__hint">{t("steamgriddb_loading")}</div>
      ) : assets.length ? (
        <div
          className={`game-steamgriddb__grid game-steamgriddb__grid--${assetType}`}
        >
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={`game-steamgriddb__item game-steamgriddb__item--${assetType} ${
                currentAssetId === asset.id
                  ? "game-steamgriddb__item--active"
                  : ""
              }`}
              onClick={() => handlePick(asset)}
            >
              <img src={asset.thumb} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <div className="game-steamgriddb__hint">
          {t("steamgriddb_no_results")}
        </div>
      )}
    </div>
  );
}
