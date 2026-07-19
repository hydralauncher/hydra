import type { ChangeEvent, MutableRefObject } from "react";
import type { GameArtworkSelection, LibraryGame, ShopAssets } from "@types";
import { PencilIcon } from "@primer/octicons-react";
import { Loader2, Trash } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isVideoArtworkUrl } from "@renderer/hooks";
import {
  FileExplorerModal,
  FocusItem,
  Input,
  Tabs,
  type TabsItem,
  type FileFilter,
  VerticalFocusGroup,
} from "../../../common";
import {
  resolveImageSource,
  resolvePreferredGameAssets,
} from "../../../../helpers";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { GameArtworkPicker } from "./artwork-picker";

import "./customization-tab.scss";

export const GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID =
  "game-customization-settings-primary-control";
const GAME_CUSTOMIZATION_SETTINGS_ASSET_PREVIEW_ID =
  "game-customization-settings-asset-preview";

type AssetTab = "icon" | "logo" | "hero" | "grid";
type AssetPreviewState = Record<
  AssetTab,
  {
    src: string;
    hasCustom: boolean;
    hasArtworkSelection: boolean;
  }
>;

const PREVIEW_MEDIA_TIMEOUT_MS = 10_000;
type AssetPreviewMediaElement = HTMLImageElement | HTMLVideoElement;

interface AssetPreviewMediaProps {
  source: string;
  mediaKey: string;
  title: string;
  isLoaded: boolean;
  mediaRef: MutableRefObject<AssetPreviewMediaElement | null>;
  onSettled: () => void;
}

function AssetPreviewMedia({
  source,
  mediaKey,
  title,
  isLoaded,
  mediaRef,
  onSettled,
}: Readonly<AssetPreviewMediaProps>) {
  if (!source) return null;

  const className = `game-customization-settings-tab__asset-preview-image${
    isLoaded
      ? " game-customization-settings-tab__asset-preview-image--loaded"
      : ""
  }`;
  const setMediaRef = (media: AssetPreviewMediaElement | null) => {
    mediaRef.current = media;
  };

  if (isVideoArtworkUrl(source)) {
    return (
      <video
        key={mediaKey}
        ref={setMediaRef}
        className={className}
        src={source}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        preload="auto"
        onLoadedData={onSettled}
        onError={onSettled}
      />
    );
  }

  return (
    <img
      key={mediaKey}
      ref={setMediaRef}
      className={className}
      src={source}
      alt={title}
      draggable={false}
      onLoad={onSettled}
      onError={onSettled}
    />
  );
}

const ASSET_FRAME_SIZES: Record<AssetTab, { width: number; height: number }> = {
  icon: { width: 192, height: 192 },
  logo: { width: 341.33, height: 192 },
  hero: { width: 594.58, height: 192 },
  grid: { width: 128, height: 192 },
};

export interface GameCustomizationSettingsProps {
  game: LibraryGame;
  gameTitle: string;
  updatingGameTitle: boolean;
  assetPickerFilters: FileFilter[];
  onChangeGameTitle: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlurGameTitle: () => Promise<void>;
  onProcessAssetPath: (
    sourcePath: string,
    assetType: AssetTab
  ) => Promise<string | null>;
  onClearAsset: (
    assetType: AssetTab,
    clearArtworkSelection: boolean
  ) => Promise<boolean>;
  onArtworkChanged: () => Promise<void> | void;
}

function getAssetPreviewState(
  game: LibraryGame,
  assets: ShopAssets | null,
  artworkSelection: GameArtworkSelection | null
): AssetPreviewState {
  const preferredAssets = resolvePreferredGameAssets(game, assets);
  const isCustom = game.shop === "custom";
  const selectedArtwork = artworkSelection?.selected;

  return {
    icon: {
      src: preferredAssets.iconSrc,
      hasCustom: isCustom
        ? Boolean(game.iconUrl)
        : Boolean(game.customIconUrl || selectedArtwork?.icon),
      hasArtworkSelection: Boolean(selectedArtwork?.icon),
    },
    logo: {
      src: preferredAssets.logoSrc,
      hasCustom: isCustom
        ? Boolean(game.logoImageUrl)
        : Boolean(game.customLogoImageUrl || selectedArtwork?.logo),
      hasArtworkSelection: Boolean(selectedArtwork?.logo),
    },
    hero: {
      src: resolveImageSource(preferredAssets.libraryHeroImageUrl),
      hasCustom: isCustom
        ? Boolean(game.libraryHeroImageUrl)
        : Boolean(game.customHeroImageUrl || selectedArtwork?.hero),
      hasArtworkSelection: Boolean(selectedArtwork?.hero),
    },
    grid: {
      src: resolveImageSource(preferredAssets.coverImageUrl),
      hasCustom: Boolean(game.customCoverImageUrl || selectedArtwork?.grid),
      hasArtworkSelection: Boolean(selectedArtwork?.grid),
    },
  };
}

function getFallbackPreviewState(
  game: LibraryGame,
  assetType: AssetTab,
  assets: ShopAssets | null
): AssetPreviewState[AssetTab] {
  const isCustom = game.shop === "custom";

  if (assetType === "icon") {
    const nextGame = {
      ...game,
      [isCustom ? "iconUrl" : "customIconUrl"]: null,
    };

    return {
      src: resolvePreferredGameAssets(nextGame, assets).iconSrc,
      hasCustom: false,
      hasArtworkSelection: false,
    };
  }

  if (assetType === "logo") {
    const nextGame = {
      ...game,
      [isCustom ? "logoImageUrl" : "customLogoImageUrl"]: null,
    };

    return {
      src: resolvePreferredGameAssets(nextGame, assets).logoSrc,
      hasCustom: false,
      hasArtworkSelection: false,
    };
  }

  if (assetType === "grid") {
    const nextGame = { ...game, customCoverImageUrl: null };

    return {
      src: resolveImageSource(
        resolvePreferredGameAssets(nextGame, assets).coverImageUrl
      ),
      hasCustom: false,
      hasArtworkSelection: false,
    };
  }

  const nextGame = {
    ...game,
    [isCustom ? "libraryHeroImageUrl" : "customHeroImageUrl"]: null,
  };

  return {
    src: resolveImageSource(
      resolvePreferredGameAssets(nextGame, assets).libraryHeroImageUrl
    ),
    hasCustom: false,
    hasArtworkSelection: false,
  };
}

export function GameCustomizationSettingsTab({
  game,
  gameTitle,
  updatingGameTitle,
  assetPickerFilters,
  onChangeGameTitle,
  onBlurGameTitle,
  onProcessAssetPath,
  onClearAsset,
  onArtworkChanged,
}: Readonly<GameCustomizationSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const [selectedAssetTab, setSelectedAssetTab] = useState<AssetTab>("icon");
  const [hasAssetTabsInteracted, setHasAssetTabsInteracted] = useState(false);
  const [composedAssets, setComposedAssets] = useState<ShopAssets | null>(null);
  const [artworkSelection, setArtworkSelection] =
    useState<GameArtworkSelection | null>(null);
  const [assetPreviewState, setAssetPreviewState] = useState<AssetPreviewState>(
    () => getAssetPreviewState(game, null, null)
  );
  const [artworkSelectionVersion, setArtworkSelectionVersion] = useState(0);
  const [pendingAssetTab, setPendingAssetTab] = useState<AssetTab | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const isCustomGame = game.shop === "custom";

  const refreshArtworkState = useCallback(async () => {
    if (game.shop === "custom") {
      setComposedAssets(null);
      setArtworkSelection(null);
      return;
    }

    const [assets, selection] = await Promise.all([
      globalThis.window.electron.getGameAssets(game.objectId, game.shop),
      globalThis.window.electron.getGameArtworkSelection(
        game.shop,
        game.objectId
      ),
    ]);
    setComposedAssets(assets);
    setArtworkSelection(selection);
  }, [game.objectId, game.shop]);
  const assetTabItems = useMemo(() => {
    const items: Array<TabsItem<AssetTab>> = [
      {
        value: "icon",
        label: t("edit_game_modal_icon"),
      },
      {
        value: "logo",
        label: t("edit_game_modal_logo"),
      },
      {
        value: "hero",
        label: t("edit_game_modal_hero"),
      },
    ];

    if (!isCustomGame) {
      items.push({
        value: "grid",
        label: t("edit_game_modal_grid"),
      });
    }

    return items;
  }, [t, isCustomGame]);

  const handleAssetTabChange = useCallback((value: AssetTab) => {
    setSelectedAssetTab(value);
    setHasAssetTabsInteracted(true);
  }, []);
  const assetFrameSize = ASSET_FRAME_SIZES[selectedAssetTab];
  const hasCustomAsset = assetPreviewState[selectedAssetTab].hasCustom;
  const hasArtworkSelection =
    assetPreviewState[selectedAssetTab].hasArtworkSelection;
  const assetImageSource = assetPreviewState[selectedAssetTab].src;
  const previewMediaKey = `${selectedAssetTab}:${assetImageSource}`;
  const [settledPreviewMediaKey, setSettledPreviewMediaKey] = useState<
    string | null
  >(null);
  const previewMediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(
    null
  );
  const isPreviewMediaLoaded =
    !assetImageSource || settledPreviewMediaKey === previewMediaKey;

  useEffect(() => {
    if (settledPreviewMediaKey === previewMediaKey) return;

    if (!assetImageSource) {
      setSettledPreviewMediaKey(previewMediaKey);
      return;
    }

    setSettledPreviewMediaKey(null);

    const media = previewMediaRef.current;
    const isReady =
      media instanceof HTMLVideoElement
        ? media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        : Boolean(media?.complete && media.naturalWidth > 0);

    if (isReady) {
      setSettledPreviewMediaKey(previewMediaKey);
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setSettledPreviewMediaKey(previewMediaKey);
    }, PREVIEW_MEDIA_TIMEOUT_MS);

    return () => globalThis.clearTimeout(timeoutId);
  }, [assetImageSource, previewMediaKey, settledPreviewMediaKey]);

  const handleAssetPicked = useCallback(
    (path: string) => {
      setAssetPickerOpen(false);
      setPendingAssetTab(selectedAssetTab);

      void onProcessAssetPath(path, selectedAssetTab)
        .then((copiedAssetUrl) => {
          if (!copiedAssetUrl) return;

          setArtworkSelection((currentSelection) => {
            if (!currentSelection?.selected[selectedAssetTab]) {
              return currentSelection;
            }

            const selected = { ...currentSelection.selected };
            delete selected[selectedAssetTab];

            return {
              ...currentSelection,
              selected,
            };
          });
          setAssetPreviewState((currentState) => ({
            ...currentState,
            [selectedAssetTab]: {
              src: resolveImageSource(copiedAssetUrl),
              hasCustom: true,
              hasArtworkSelection: false,
            },
          }));
          setArtworkSelectionVersion((version) => version + 1);
        })
        .finally(() => {
          setPendingAssetTab(null);
        });
    },
    [onProcessAssetPath, selectedAssetTab]
  );

  const handleAssetPickerClose = useCallback(() => {
    setAssetPickerOpen(false);
    setPendingAssetTab(null);
  }, []);

  const handleAssetPreviewAction = useCallback(() => {
    if (pendingAssetTab) return;

    if (hasCustomAsset) {
      setPendingAssetTab(selectedAssetTab);
      setAssetPreviewState((currentState) => ({
        ...currentState,
        [selectedAssetTab]: getFallbackPreviewState(
          game,
          selectedAssetTab,
          hasArtworkSelection ? null : composedAssets
        ),
      }));

      void onClearAsset(selectedAssetTab, hasArtworkSelection)
        .then(async (wasCleared) => {
          if (!wasCleared) {
            setAssetPreviewState(
              getAssetPreviewState(game, composedAssets, artworkSelection)
            );
            return;
          }

          if (hasArtworkSelection) {
            await refreshArtworkState();
          }

          setArtworkSelectionVersion((version) => version + 1);
        })
        .finally(() => {
          setPendingAssetTab((currentTab) =>
            currentTab === selectedAssetTab ? null : currentTab
          );
        });
      return;
    }

    setAssetPickerOpen(true);
  }, [
    composedAssets,
    game,
    hasArtworkSelection,
    hasCustomAsset,
    onClearAsset,
    pendingAssetTab,
    artworkSelection,
    refreshArtworkState,
    selectedAssetTab,
  ]);

  useEffect(() => {
    refreshArtworkState().catch(() => {});
  }, [refreshArtworkState]);

  useEffect(() => {
    setAssetPreviewState(
      getAssetPreviewState(game, composedAssets, artworkSelection)
    );
  }, [game, composedAssets, artworkSelection]);

  useEffect(() => {
    setPendingAssetTab(null);
  }, [game]);

  return (
    <>
      <VerticalFocusGroup className="game-customization-settings-tab">
        <SettingsSection
          className="game-customization-settings-tab__section"
          title={t("edit_game_modal_section_title")}
          description={t("edit_game_modal_section_title_description")}
        >
          <div className="game-customization-settings-tab__section-content">
            <Input
              focusId={GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID}
              placeholder={t("edit_game_modal_enter_title")}
              value={gameTitle}
              disabled={updatingGameTitle}
              onChange={onChangeGameTitle}
              onBlur={() => {
                void onBlurGameTitle();
              }}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          className="game-customization-settings-tab__section game-customization-settings-tab__section--assets"
          title={t("edit_game_modal_assets")}
          description={t("edit_game_modal_section_assets_description")}
        >
          <div
            className={`game-customization-settings-tab__section-content game-customization-settings-tab__section-content--assets${
              isCustomGame
                ? ""
                : " game-customization-settings-tab__section-content--with-picker"
            }`}
          >
            <Tabs
              items={assetTabItems}
              value={selectedAssetTab}
              defaultValue="icon"
              onValueChange={handleAssetTabChange}
              itemsFocusable
              animateSegmentedIndicator={hasAssetTabsInteracted}
              variant="segmented"
              ariaLabel={t("edit_game_modal_assets")}
              className="game-customization-settings-tab__asset-tabs"
            />

            <div className="game-customization-settings-tab__asset-preview">
              <FocusItem
                id={GAME_CUSTOMIZATION_SETTINGS_ASSET_PREVIEW_ID}
                asChild
                actions={{
                  primary: handleAssetPreviewAction,
                }}
              >
                <button
                  type="button"
                  className="game-customization-settings-tab__asset-preview-frame"
                  onClick={handleAssetPreviewAction}
                  style={{
                    width: assetFrameSize.width,
                    height: assetFrameSize.height,
                  }}
                  aria-label={
                    hasCustomAsset
                      ? t("edit_game_modal_remove_asset")
                      : t("edit_game_modal_assets")
                  }
                >
                  <AssetPreviewMedia
                    source={assetImageSource}
                    mediaKey={previewMediaKey}
                    title={gameTitle}
                    isLoaded={isPreviewMediaLoaded}
                    mediaRef={previewMediaRef}
                    onSettled={() => setSettledPreviewMediaKey(previewMediaKey)}
                  />

                  {assetImageSource && !isPreviewMediaLoaded ? (
                    <span
                      className="game-customization-settings-tab__asset-preview-spinner"
                      aria-hidden="true"
                    >
                      <Loader2 size={28} />
                    </span>
                  ) : null}

                  <span
                    className={`game-customization-settings-tab__asset-preview-overlay${
                      hasCustomAsset
                        ? " game-customization-settings-tab__asset-preview-overlay--danger"
                        : ""
                    }`}
                    aria-hidden="true"
                  >
                    <span
                      className={`game-customization-settings-tab__asset-preview-overlay-icon${
                        hasCustomAsset
                          ? " game-customization-settings-tab__asset-preview-overlay-icon--danger"
                          : ""
                      }`}
                    >
                      {hasCustomAsset ? (
                        <Trash size={20} />
                      ) : (
                        <PencilIcon size={22} />
                      )}
                    </span>
                  </span>
                </button>
              </FocusItem>
            </div>

            {!isCustomGame ? (
              <GameArtworkPicker
                key={`${game.shop}:${game.objectId}:${selectedAssetTab}`}
                game={game}
                assetType={selectedAssetTab}
                selectionVersion={artworkSelectionVersion}
                onChanged={async () => {
                  await refreshArtworkState();
                  void Promise.resolve(onArtworkChanged()).catch(() => {});
                }}
              />
            ) : null}
          </div>
        </SettingsSection>
      </VerticalFocusGroup>

      <FileExplorerModal
        visible={assetPickerOpen}
        onClose={handleAssetPickerClose}
        onSelect={handleAssetPicked}
        title={t("edit_game_modal_assets")}
        filters={assetPickerFilters}
      />
    </>
  );
}
