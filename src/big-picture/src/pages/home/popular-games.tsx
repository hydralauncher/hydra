import type { ShopAssets } from "@types";
import { useNavigate } from "react-router-dom";
import {
  FocusItem,
  HorizontalFocusGroup,
  VerticalStoreGameCard,
} from "../../components";
import { getBigPictureGameDetailsPath } from "../../helpers";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../layout";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import { HOME_HERO_ACTIONS_REGION_ID } from "./navigation";

function getGameCover(game: ShopAssets) {
  return game.coverImageUrl ?? game.libraryImageUrl ?? game.iconUrl;
}

interface PopularGamesProps {
  title: string;
  games: ShopAssets[];
  rowId: string;
  getFocusId: (game: Pick<ShopAssets, "shop" | "objectId">) => string;
  getUpFocusId?: (gameIndex: number) => string | null;
  getDownFocusId?: (gameIndex: number) => string | null;
  canNavigateUpToHero?: boolean;
}

export function PopularGames({
  title,
  games,
  rowId,
  getFocusId,
  getUpFocusId,
  getDownFocusId,
  canNavigateUpToHero = true,
}: Readonly<PopularGamesProps>) {
  const navigate = useNavigate();

  if (!games.length) return null;

  return (
    <section className="home-page__popular-games">
      <h2 className="home-page__popular-games-title">{title}</h2>

      <HorizontalFocusGroup
        className="home-page__popular-games-row"
        regionId={rowId}
      >
        {games.map((game, index) => {
          const previousGame = games[index - 1];
          const nextGame = games[index + 1];
          const upFromParent = getUpFocusId?.(index);
          const upTarget: FocusOverrideTarget =
            getUpFocusId === undefined
              ? canNavigateUpToHero
                ? {
                    type: "region",
                    regionId: HOME_HERO_ACTIONS_REGION_ID,
                    entryDirection: "right",
                  }
                : { type: "block" }
              : upFromParent
                ? { type: "item", itemId: upFromParent }
                : { type: "block" };
          const downFocusId = getDownFocusId?.(index) ?? null;
          const gameDetailsPath = getBigPictureGameDetailsPath(game);
          const navigationOverrides: FocusOverrides = {
            left: previousGame
              ? { type: "item", itemId: getFocusId(previousGame) }
              : {
                  type: "item",
                  itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.home,
                },
            right: nextGame
              ? { type: "item", itemId: getFocusId(nextGame) }
              : { type: "block" },
            up: upTarget,
            down: downFocusId
              ? { type: "item", itemId: downFocusId }
              : { type: "block" },
          };

          return (
            <FocusItem
              key={`${game.shop}:${game.objectId}`}
              id={getFocusId(game)}
              navigationOverrides={navigationOverrides}
              actions={{
                primary: () => navigate(gameDetailsPath),
              }}
            >
              <VerticalStoreGameCard
                coverImageUrl={getGameCover(game)}
                gameTitle={game.title}
                downloadSourceCount={game.downloadSources.length}
                onClick={() => navigate(gameDetailsPath)}
              />
            </FocusItem>
          );
        })}
      </HorizontalFocusGroup>
    </section>
  );
}
