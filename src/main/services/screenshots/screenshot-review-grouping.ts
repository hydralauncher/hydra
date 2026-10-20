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
