import { formatNumber } from "@renderer/helpers";
import type { GameShop } from "@types";
import { useParams } from "react-router-dom";
import {
  Divider,
  FocusItem,
  HorizontalFocusGroup,
  SingleLineBox,
  TitleBox,
  VerticalFocusGroup,
} from "../../components";
import {
  AchievementsBox,
  GameReviews,
  Hero,
  HowLongToBeatBox,
  SupportedLanguages,
  PlaytimeBar,
  RequirementsToPlay,
  ScreenshotCarousel,
} from "../../components/pages/game";
import { useGameDetails } from "../../hooks";
import "./game.scss";

export default function Game() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const {
    shopDetails,
    game,
    stats,
    isGameRunning,
    isLoading,
    howLongToBeat,
    achievements,
    openGame,
    closeGame,
    toggleFavorite,
  } = useGameDetails(objectId!, shop!);

  if (isLoading || !shopDetails) {
    return (
      <div className="game-page">
        <p style={{ color: "white" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="game-page">
      <Hero
        shopDetails={shopDetails}
        game={game}
        isGameRunning={isGameRunning}
        isFavorite={game?.favorite ?? false}
        toggleFavorite={toggleFavorite}
        onPlay={openGame}
        onClose={closeGame}
      />

      <section className="game-page__content">
        <PlaytimeBar game={game} />

        <HorizontalFocusGroup regionId="game-main-content" asChild>
          <div className="game-page__main-layout">
            <VerticalFocusGroup regionId="game-main-content-1" asChild>
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
            </VerticalFocusGroup>

            <VerticalFocusGroup regionId="sidebar-actions" asChild>
              <div className="game-page__sidebar">
                <HorizontalFocusGroup asChild>
                  <div className="game-page__sidebar-stats">
                    <div className="game-page__box-group">
                      <FocusItem>
                        <TitleBox title="Stats" />
                      </FocusItem>

                      <SingleLineBox
                        title="Rating"
                        value={formatNumber(stats?.averageScore ?? 0)}
                      />
                      <SingleLineBox
                        title="Downloads"
                        value={formatNumber(stats?.downloadCount ?? 0)}
                      />
                      <SingleLineBox
                        title="Playing Now"
                        value={formatNumber(stats?.playerCount ?? 0)}
                      />
                    </div>
                  </div>
                </HorizontalFocusGroup>

                <HowLongToBeatBox howLongToBeat={howLongToBeat ?? []} />

                <AchievementsBox achievements={achievements ?? []} />

                <div className="game-page__box-group">
                  <SingleLineBox
                    title="Published by"
                    value={shopDetails.publishers[0]}
                  />

                  <SingleLineBox
                    title="Release Date"
                    value={shopDetails.release_date.date}
                  />
                </div>

                <RequirementsToPlay shopDetails={shopDetails} />

                <SupportedLanguages shopDetails={shopDetails} />
              </div>
            </VerticalFocusGroup>
          </div>
        </HorizontalFocusGroup>
      </section>
    </div>
  );
}
