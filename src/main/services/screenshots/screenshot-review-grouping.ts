export const MAX_SINGLE_REVIEW_WINDOWS = 5;

export interface ScreenshotReviewGrouping {
  singleClientIds: string[];
  gridClientIds: string[];
}

export type ScreenshotReviewAssignment =
  | { kind: "single"; clientId: string }
  | { kind: "grid"; clientIds: string[]; isNewGrid: boolean };

export const createScreenshotReviewGrouping = (): ScreenshotReviewGrouping => ({
  singleClientIds: [],
  gridClientIds: [],
});

export const assignScreenshotReview = (
  grouping: ScreenshotReviewGrouping,
  clientId: string
): {
  grouping: ScreenshotReviewGrouping;
  assignment: ScreenshotReviewAssignment;
} => {
  if (grouping.singleClientIds.length < MAX_SINGLE_REVIEW_WINDOWS) {
    return {
      grouping: {
        ...grouping,
        singleClientIds: [...grouping.singleClientIds, clientId],
      },
      assignment: { kind: "single", clientId },
    };
  }

  const gridClientIds = [...grouping.gridClientIds, clientId];
  return {
    grouping: { ...grouping, gridClientIds },
    assignment: {
      kind: "grid",
      clientIds: gridClientIds,
      isNewGrid: grouping.gridClientIds.length === 0,
    },
  };
};

export const REVIEW_WINDOW_CASCADE_OFFSET = 32;

export interface ReviewWindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const getCascadedReviewWindowBounds = (
  index: number,
  size: { width: number; height: number },
  workArea: ReviewWindowRectangle
): ReviewWindowRectangle => {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const centeredX = workArea.x + Math.round((workArea.width - width) / 2);
  const centeredY = workArea.y + Math.round((workArea.height - height) / 2);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const offset = Math.max(0, index) * REVIEW_WINDOW_CASCADE_OFFSET;

  return {
    x: Math.max(workArea.x, Math.min(maxX, centeredX + offset)),
    y: Math.max(workArea.y, Math.min(maxY, centeredY + offset)),
    width,
    height,
  };
};
