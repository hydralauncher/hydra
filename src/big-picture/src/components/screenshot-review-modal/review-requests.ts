import type { ScreenshotReviewRequest } from "@types";

type ReviewRequestListener = (request: ScreenshotReviewRequest) => void;

const listeners = new Set<ReviewRequestListener>();

export const subscribeScreenshotReviewRequests = (
  listener: ReviewRequestListener
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const requestScreenshotReview = (request: ScreenshotReviewRequest) => {
  for (const listener of listeners) listener(request);
  return listeners.size > 0;
};
