import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import type { GameShop } from "@types";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { vars } from "@renderer/theme.css";
import {
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "@renderer/context";
import { SkeletonTheme } from "react-loading-skeleton";
import { AchievementsSkeleton } from "./achievements-skeleton";
import { AchievementsContent } from "./achievements-content";

export function Achievement() {
  const [searchParams] = useSearchParams();
  const objectId = searchParams.get("objectId");
  const shop = searchParams.get("shop");
  const title = searchParams.get("title");
  const userId = searchParams.get("userId");
  const displayName = searchParams.get("displayName");

  const dispatch = useAppDispatch();

  useEffect(() => {
    if (title) {
      dispatch(setHeaderTitle(title));
    }
  }, [dispatch, title]);

  if (!objectId || !shop || !title) return null;

  return (
    <GameDetailsContextProvider
      gameTitle={title}
      shop={shop as GameShop}
      objectId={objectId}
    >
      <GameDetailsContextConsumer>
        {({ isLoading }) => {
          return (
            <SkeletonTheme
              baseColor={vars.color.background}
              highlightColor="#444"
            >
              {isLoading ? (
                <AchievementsSkeleton />
              ) : (
                <AchievementsContent
                  userId={userId}
                  displayName={displayName}
                />
              )}
            </SkeletonTheme>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
