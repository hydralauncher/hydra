import { formatNumber } from "@renderer/helpers";
import type { GameShop } from "@types";
import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { Typography, VerticalFocusGroup, Divider } from "../../components";
import { DownloadGameModal } from "../../components/modals";
import {
  AchievementsBox,
  GameReviews,
  Hero,
  HowLongToBeatBox,
  PlaytimeBar,
  ProtonDBSection,
  RequirementsToPlay,
  ScreenshotCarousel,
  SupportedLanguages,
} from "../../components/pages/game";
import { GAME_PAGE_REGION_ID } from "../../components/pages/game/navigation";
import { useGameDetails, useHeaderTitle } from "../../hooks";
import "./game.scss";

export default function Game() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);
  const {
    shopDetails,
    game,
    stats,
    isGameRunning,
    isLoading,
    howLongToBeat,
    protonDBData,
    achievements,
    openGame,
    closeGame,
    toggleFavorite,
    updateGame,
  } = useGameDetails(objectId!, shop!);
  const canAddToLibrary = shop !== "custom";
  const resolvedGameTitle =
    shopDetails?.assets?.title ?? game?.title ?? "Download Game";

  useHeaderTitle(shopDetails?.assets?.title ?? game?.title);

  const handleOpenDownloadModal = useCallback(() => {
    setIsDownloadModalOpen(true);
  }, []);

  const handleCloseDownloadModal = useCallback(() => {
    setIsDownloadModalOpen(false);
  }, []);

  const handleAddToLibrary = useCallback(async () => {
    if (
      !shop ||
      !objectId ||
      !canAddToLibrary ||
      game ||
      isAddingToLibrary ||
      !shopDetails
    ) {
      return;
    }

    setIsAddingToLibrary(true);

    try {
      await globalThis.window.electron.addGameToLibrary(
        shop,
        objectId,
        resolvedGameTitle
      );
      await updateGame();
      globalThis.window.dispatchEvent(new Event("library-update"));
    } finally {
      setIsAddingToLibrary(false);
    }
  }, [
    canAddToLibrary,
    game,
    isAddingToLibrary,
    objectId,
    resolvedGameTitle,
    shop,
    shopDetails,
    updateGame,
  ]);

  if (isLoading || !shopDetails) {
    return (
      <VerticalFocusGroup regionId={GAME_PAGE_REGION_ID} asChild>
        <div className="game-page">
          <p style={{ color: "white" }}>Loading...</p>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={GAME_PAGE_REGION_ID} asChild>
      <div className="game-page">
        <Hero
          shopDetails={shopDetails}
          game={game}
          isGameRunning={isGameRunning}
          isFavorite={game?.favorite ?? false}
          toggleFavorite={toggleFavorite}
          onPlay={openGame}
          onDownload={handleOpenDownloadModal}
          onAddToLibrary={handleAddToLibrary}
          onOpenDownloadOptions={handleOpenDownloadModal}
          onClose={closeGame}
          isAddingToLibrary={isAddingToLibrary}
          canAddToLibrary={canAddToLibrary}
        />

        <section className="game-page__content">
          <PlaytimeBar game={game} />

          <div className="game-page__main-layout">
            <div className="game-page__main-column">
              <ScreenshotCarousel
                videos={shopDetails.movies ?? []}
                screenshots={shopDetails.screenshots ?? []}
              />

              <div
                dangerouslySetInnerHTML={{
                  __html: shopDetails.detailed_description,
                }}
                className="game-page__detailed-description"
              />

              <Divider />

              <GameReviews shop={shop!} objectId={objectId!} />
            </div>

            <div className="game-page__sidebar">
              <section className="game-page__stats" aria-label="Stats">
                <div className="game-page__stats-title">
                  <Typography>Stats</Typography>
                </div>

                <div className="game-page__stats-row">
                  <Typography className="game-page__stats-label">
                    Rating
                  </Typography>
                  <Typography className="game-page__stats-value">
                    {formatNumber(stats?.averageScore ?? 0)}
                  </Typography>
                </div>

                <div className="game-page__stats-row">
                  <Typography className="game-page__stats-label">
                    Downloads
                  </Typography>
                  <Typography className="game-page__stats-value">
                    {formatNumber(stats?.downloadCount ?? 0)}
                  </Typography>
                </div>

                <div className="game-page__stats-row">
                  <Typography className="game-page__stats-label">
                    Playing now
                  </Typography>
                  <Typography className="game-page__stats-value">
                    {formatNumber(stats?.playerCount ?? 0)}
                  </Typography>
                </div>
              </section>

              <HowLongToBeatBox howLongToBeat={howLongToBeat ?? []} />

              <ProtonDBSection protonDBData={protonDBData} />

              <AchievementsBox achievements={achievements ?? []} />

              <section className="game-page__metadata" aria-label="Game info">
                {shopDetails.developers[0] && (
                  <div className="game-page__metadata-row">
                    <Typography className="game-page__metadata-label">
                      Developed by
                    </Typography>
                    <Typography className="game-page__metadata-value">
                      {shopDetails.developers[0]}
                    </Typography>
                  </div>
                )}

                {shopDetails.publishers[0] && (
                  <div className="game-page__metadata-row">
                    <Typography className="game-page__metadata-label">
                      Published by
                    </Typography>
                    <Typography className="game-page__metadata-value">
                      {shopDetails.publishers[0]}
                    </Typography>
                  </div>
                )}

                <div className="game-page__metadata-row">
                  <Typography className="game-page__metadata-label">
                    Release Date
                  </Typography>
                  <Typography className="game-page__metadata-value">
                    {shopDetails.release_date.date}
                  </Typography>
                </div>
              </section>

              <RequirementsToPlay shopDetails={shopDetails} />

              <SupportedLanguages shopDetails={shopDetails} />
            </div>
          </div>
        </section>

        <DownloadGameModal
          visible={isDownloadModalOpen}
          onClose={handleCloseDownloadModal}
          game={{
            objectId: objectId!,
            shop: shop!,
            title: shopDetails.assets?.title ?? game?.title ?? "Download Game",
            libraryHeroImageUrl:
              shopDetails.assets?.libraryHeroImageUrl ?? null,
          }}
        />
      </div>
    </VerticalFocusGroup>
  );
}
