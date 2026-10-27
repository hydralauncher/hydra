import { useEffect, useState } from "react";

import type { GameShop } from "@types";
import {
  pickTopReview,
  type LeaderboardReview,
  type UserReviewsResponse,
} from "./global-leaderboard";

const topReviewByUser = new Map<string, Promise<LeaderboardReview | null>>();

const toPlainText = (html: string) =>
  new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ??
  "";

const loadTopReview = async (
  userId: string
): Promise<LeaderboardReview | null> => {
  const response = await window.electron.hydraApi.get<UserReviewsResponse>(
    `/users/${userId}/reviews`,
    { needsAuth: false }
  );
  const review = pickTopReview(response.reviews ?? []);
  if (!review) return null;

  const { shop, objectId, title, iconUrl } = review.game;
  const assets = await window.electron
    .getGameAssets(objectId, shop as GameShop)
    .catch(() => null);

  return {
    gameTitle: title,
    shop,
    objectId,
    coverImageUrl:
      assets?.coverImageUrl || assets?.libraryImageUrl || iconUrl || null,
    score: review.score,
    createdAt: review.createdAt,
    text: toPlainText(review.reviewHtml),
  };
};

const getTopReview = (userId: string) => {
  let review = topReviewByUser.get(userId);
  if (!review) {
    review = loadTopReview(userId).catch(() => {
      topReviewByUser.delete(userId);
      return null;
    });
    topReviewByUser.set(userId, review);
  }
  return review;
};

export function useTopReview(userId: string | null) {
  const [review, setReview] = useState<LeaderboardReview | null>(null);

  useEffect(() => {
    setReview(null);
    if (!userId) return;
    let cancelled = false;
    void getTopReview(userId).then((result) => {
      if (!cancelled) setReview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return review;
}
