import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useUserDetails } from "@renderer/hooks";
import type { ComparedAchievements, GameShop } from "@types";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { vars } from "@renderer/theme.css";
import {
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "@renderer/context";
import { SkeletonTheme } from "react-loading-skeleton";
import { AchievementsSkeleton } from "./achievements-skeleton";
import { AchievementsContent } from "./achievements-content";

export default function Achievements() {
  const [searchParams] = useSearchParams();
  const objectId = searchParams.get("objectId");
  const shop = searchParams.get("shop");
  const title = searchParams.get("title");
  const userId = searchParams.get("userId");

  const { userDetails } = useUserDetails();

  const [comparedAchievements, setComparedAchievements] =
    useState<ComparedAchievements | null>(null);

  const dispatch = useAppDispatch();

  useEffect(() => {
    if (title) {
      dispatch(setHeaderTitle(title));
    }
  }, [dispatch, title]);

  useEffect(() => {
    setComparedAchievements(null);

    if (userDetails?.id == userId) {
      return;
    }

    if (objectId && shop && userId) {
      window.electron
        .getComparedUnlockedAchievements(objectId, shop as GameShop, userId)
        .then(setComparedAchievements);
    }
  }, [objectId, shop, userId]);

  const otherUserId = userDetails?.id === userId ? null : userId;

  const otherUser = useMemo(() => {
    if (!otherUserId || !comparedAchievements) return null;

    return {
      userId: otherUserId,
      displayName: comparedAchievements.target.displayName,
      profileImageUrl: comparedAchievements.target.profileImageUrl,
      totalAchievementCount: comparedAchievements.target.totalAchievementCount,
      unlockedAchievementCount:
        comparedAchievements.target.unlockedAchievementCount,
    };
  }, [otherUserId, comparedAchievements]);

  return (
    <GameDetailsContextProvider
      gameTitle={title!}
      shop={shop as GameShop}
      objectId={objectId!}
    >
      <GameDetailsContextConsumer>
        {({ isLoading, achievements }) => {
          const showSkeleton =
            isLoading ||
            achievements === null ||
            (otherUserId && comparedAchievements === null);

          return (
            <SkeletonTheme
              baseColor={vars.color.background}
              highlightColor="#444"
            >
              {showSkeleton ? (
                <AchievementsSkeleton />
              ) : (
                <AchievementsContent
                  otherUser={otherUser}
                  comparedAchievements={comparedAchievements!}
                />
              )}
            </SkeletonTheme>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
