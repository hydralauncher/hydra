import { HomePageHero } from "./hero";
import { useFeaturedGame } from "./hero/use-featured-game";
import { type HomeChallengeGame } from "./home-data";
import { useHotGames } from "./use-hot-games";
import { useHomeChallengeGridNavigation } from "./use-home-challenge-grid-navigation";
import { useHardPlatinums } from "./use-hard-platinums";
import { useWeeklyGames } from "./use-weekly-games";
import {
  getHomeChallengeGameItemId,
  getHomeTrendingGameItemId,
  getHomeWeeklyGameItemId,
  HOME_HARD_PLATINUMS_GRID_REGION_ID,
  HOME_HERO_ACTIONS_REGION_ID,
  HOME_PAGE_REGION_ID,
  HOME_TRENDING_GAMES_CAROUSEL_REGION_ID,
  HOME_WEEKLY_GAMES_CAROUSEL_REGION_ID,
} from "./navigation";
import {
  getBigPictureGameDetailsPath,
  getGameLandscapeImageSource,
  getItemFocusTarget,
} from "../../helpers";
import {
  BIG_PICTURE_HEADER_REGION_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
} from "../../layout";
import {
  ChallengeGameCard,
  FocusCarousel,
  FocusItem,
  GridFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import { useNavigate } from "react-router-dom";

import "./page.scss";

const HOME_SECTION_ORDER = ["hero", "weekly", "trending", "challenge"] as const;

type HomeSectionId = (typeof HOME_SECTION_ORDER)[number];

export default function Home() {
  const navigate = useNavigate();
  const { featuredGame } = useFeaturedGame();
  const hardPlatinums = useHardPlatinums();
  const hotGames = useHotGames();
  const weeklyGames = useWeeklyGames();
  const hasHero = featuredGame != null;
  const hasWeekly = weeklyGames.length > 0;
  const hasTrending = hotGames.length > 0;
  const hasChallenge = hardPlatinums.length > 0;

  const homeSectionRegionIdById: Record<
    Exclude<HomeSectionId, "hero">,
    string
  > = {
    weekly: HOME_WEEKLY_GAMES_CAROUSEL_REGION_ID,
    trending: HOME_TRENDING_GAMES_CAROUSEL_REGION_ID,
    challenge: HOME_HARD_PLATINUMS_GRID_REGION_ID,
  };

  const availableSections = HOME_SECTION_ORDER.filter((sectionId) => {
    switch (sectionId) {
      case "hero":
        return hasHero;
      case "weekly":
        return hasWeekly;
      case "trending":
        return hasTrending;
      case "challenge":
        return hasChallenge;
    }
  });

  const getRegionTarget = (
    sectionId: Exclude<HomeSectionId, "hero"> | undefined,
    entryDirection: "right" | "down" = "right"
  ): FocusOverrideTarget | undefined => {
    if (!sectionId) return undefined;

    return {
      type: "region",
      regionId: homeSectionRegionIdById[sectionId],
      entryDirection,
    };
  };

  const getFirstContentRegionBelowHero = () => {
    const nextSectionId = availableSections.find((sectionId) => {
      return sectionId !== "hero";
    });

    return getRegionTarget(nextSectionId);
  };

  const getNextRegionBelow = (sectionId: Exclude<HomeSectionId, "hero">) => {
    const currentIndex = availableSections.indexOf(sectionId);

    if (currentIndex === -1) return undefined;

    const nextSectionId = availableSections[currentIndex + 1];

    if (!nextSectionId || nextSectionId === "hero") return undefined;

    return getRegionTarget(nextSectionId);
  };

  const getPreviousRegionAbove = (
    sectionId: Exclude<HomeSectionId, "hero">
  ): { type: "region"; regionId: string; entryDirection: "right" } => {
    const currentIndex = availableSections.indexOf(sectionId);
    const previousSectionId =
      currentIndex > 0 ? availableSections[currentIndex - 1] : "hero";

    if (previousSectionId === "hero") {
      return {
        type: "region",
        regionId: HOME_HERO_ACTIONS_REGION_ID,
        entryDirection: "right",
      };
    }

    return getRegionTarget(previousSectionId) as {
      type: "region";
      regionId: string;
      entryDirection: "right";
    };
  };

  const heroDownNavigationTarget = getFirstContentRegionBelowHero();
  const heroUpNavigationTarget: FocusOverrideTarget = {
    type: "region",
    regionId: BIG_PICTURE_HEADER_REGION_ID,
    entryDirection: "down",
  };

  const getWeeklyGameNavigationOverrides = (
    _game: (typeof weeklyGames)[number],
    index: number,
    games: typeof weeklyGames
  ): FocusOverrides => ({
    ...(index === 0
      ? {
          left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
        }
      : {}),
    ...(index === games.length - 1
      ? {
          right: {
            type: "block",
          },
        }
      : {}),
    up: {
      type: "region",
      regionId: HOME_HERO_ACTIONS_REGION_ID,
      entryDirection: "right",
    },
    ...(getNextRegionBelow("weekly")
      ? {
          down: getNextRegionBelow("weekly"),
        }
      : {}),
  });

  const getHotGameNavigationOverrides = (
    _game: (typeof hotGames)[number],
    index: number,
    games: typeof hotGames
  ): FocusOverrides => ({
    ...(index === 0
      ? {
          left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
        }
      : {}),
    ...(index === games.length - 1
      ? {
          right: {
            type: "block",
          },
        }
      : {}),
    up: {
      ...getPreviousRegionAbove("trending"),
    },
    ...(getNextRegionBelow("trending")
      ? {
          down: getNextRegionBelow("trending"),
        }
      : {}),
  });

  const challengeGridUpRegionId = getPreviousRegionAbove("challenge").regionId;
  const challengeNavigationOverridesByItemId = useHomeChallengeGridNavigation(
    hardPlatinums,
    challengeGridUpRegionId
  );

  const renderChallengeCard = (game: HomeChallengeGame) => {
    const itemId = getHomeChallengeGameItemId(game);

    return (
      <FocusItem
        key={itemId}
        id={itemId}
        actions={{
          primary: () => {
            void navigate(getBigPictureGameDetailsPath(game));
          },
          secondary: "off",
        }}
        navigationOverrides={challengeNavigationOverridesByItemId[itemId]}
      >
        <ChallengeGameCard
          coverImageUrl={getGameLandscapeImageSource(game)}
          gameTitle={game.title}
          genres={game.genres}
          downloadSources={game.downloadSources}
        />
      </FocusItem>
    );
  };

  return (
    <VerticalFocusGroup regionId={HOME_PAGE_REGION_ID} asChild>
      <section className="home-page">
        <HomePageHero
          featuredGame={featuredGame}
          downNavigationTarget={heroDownNavigationTarget}
          upNavigationTarget={heroUpNavigationTarget}
        />
        <FocusCarousel
          title="Popular on Hydra"
          games={weeklyGames}
          regionId={HOME_WEEKLY_GAMES_CAROUSEL_REGION_ID}
          getItemId={getHomeWeeklyGameItemId}
          getItemNavigationOverrides={getWeeklyGameNavigationOverrides}
          onItemActivate={(game) => {
            void navigate(getBigPictureGameDetailsPath(game));
          }}
          showRightFade
        />
        <FocusCarousel
          title="Trending Right Now"
          games={hotGames}
          regionId={HOME_TRENDING_GAMES_CAROUSEL_REGION_ID}
          cardVariant="horizontal"
          getItemId={getHomeTrendingGameItemId}
          getItemNavigationOverrides={getHotGameNavigationOverrides}
          onItemActivate={(game) => {
            void navigate(getBigPictureGameDetailsPath(game));
          }}
          showRightFade
        />
        {hardPlatinums.length > 0 ? (
          <section className="home-page__challenge-section">
            <h2 className="home-page__challenge-title">
              Challenge yourself: Hard platinums
            </h2>
            <GridFocusGroup
              className="home-page__challenge-grid"
              regionId={HOME_HARD_PLATINUMS_GRID_REGION_ID}
            >
              {hardPlatinums.map(renderChallengeCard)}
            </GridFocusGroup>
          </section>
        ) : null}
      </section>
    </VerticalFocusGroup>
  );
}
