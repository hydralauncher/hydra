import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useUserDetails } from "@renderer/hooks";
import type { GameShop, UserAchievement } from "@types";
import { useEffect, useState } from "react";
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
  const displayName = searchParams.get("displayName");
  const profileImageUrl = searchParams.get("profileImageUrl");

  const { userDetails } = useUserDetails();

  const [otherUserAchievements, setOtherUserAchievements] = useState<
    UserAchievement[] | null
  >(null);

  const dispatch = useAppDispatch();

  useEffect(() => {
    if (title) {
      dispatch(setHeaderTitle(title));
    }
  }, [dispatch, title]);

  useEffect(() => {
    setOtherUserAchievements(null);
    if (userDetails?.id == userId) {
      setOtherUserAchievements([]);
      return;
    }

    if (objectId && shop && userId) {
      window.electron
        .getGameAchievements(objectId, shop as GameShop, userId)
        .then((achievements) => {
          setOtherUserAchievements(achievements);
        });
    }
  }, [objectId, shop, userId]);

  const otherUserId = userDetails?.id === userId ? null : userId;

  const otherUser = otherUserId
    ? {
        userId: otherUserId,
        displayName: displayName || "",
        achievements: otherUserAchievements || [],
        profileImageUrl: profileImageUrl || "",
      }
    : null;

  return (
    <GameDetailsContextProvider
      gameTitle={title!}
      shop={shop as GameShop}
      objectId={objectId!}
    >
      <GameDetailsContextConsumer>
        {({ isLoading, achievements }) => {
          return (
            <SkeletonTheme
              baseColor={vars.color.background}
              highlightColor="#444"
            >
              {isLoading ||
              achievements === null ||
              (otherUserId && otherUserAchievements === null) ? (
                <AchievementsSkeleton />
              ) : (
                <AchievementsContent otherUser={otherUser} />
              )}
            </SkeletonTheme>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
