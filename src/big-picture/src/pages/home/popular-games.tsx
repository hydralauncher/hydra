import type { ShopAssets } from "@types";
import { useNavigate } from "react-router-dom";
import {
  FocusItem,
  HorizontalFocusGroup,
  VerticalStoreGameCard,
} from "../../components";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../layout";
import type { FocusOverrides } from "../../services";
import { HOME_HERO_ADD_TO_LIBRARY_ID } from "./navigation";

function getGameDetailsPath(
  game: Pick<ShopAssets, "shop" | "objectId" | "title">
) {
  const searchParams = new URLSearchParams({ title: game.title });

  return `/game/${game.shop}/${game.objectId}?${searchParams.toString()}`;
}

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
}

export function PopularGames({
  title,
  games,
  rowId,
  getFocusId,
  getUpFocusId,
  getDownFocusId,
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
          const upFocusId =
            getUpFocusId?.(index) ?? HOME_HERO_ADD_TO_LIBRARY_ID;
          const downFocusId = getDownFocusId?.(index) ?? null;
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
            up: upFocusId
              ? { type: "item", itemId: upFocusId }
              : { type: "block" },
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
                primary: () => navigate(getGameDetailsPath(game)),
              }}
            >
              <VerticalStoreGameCard
                coverImageUrl={getGameCover(game)}
                gameTitle={game.title}
                downloadSourceCount={game.downloadSources.length}
              />
            </FocusItem>
          );
        })}
      </HorizontalFocusGroup>
    </section>
  );
}
