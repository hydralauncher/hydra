export const getScreenshotCommentsPanelFocusIds = (screenshotId: string) => ({
  region: `screenshot-comments:${screenshotId}`,
  composerRegion: `screenshot-comments-composer:${screenshotId}`,
  input: `screenshot-comments-input:${screenshotId}`,
  bold: `screenshot-comments-bold:${screenshotId}`,
  italic: `screenshot-comments-italic:${screenshotId}`,
  underline: `screenshot-comments-underline:${screenshotId}`,
  send: `screenshot-comments-send:${screenshotId}`,
  cancelEdit: `screenshot-comments-cancel-edit:${screenshotId}`,
  signIn: `screenshot-comments-sign-in:${screenshotId}`,
  loadMore: `screenshot-comments-load-more:${screenshotId}`,
  retry: `screenshot-comments-retry:${screenshotId}`,
  sort: `screenshot-comments-sort:${screenshotId}`,
});

export type ScreenshotCommentsPanelFocusIds = ReturnType<
  typeof getScreenshotCommentsPanelFocusIds
>;

export const COMMENTS_NAVIGATION_ORDER = {
  sort: -1,
  status: 0,
  firstComment: 1,
  loadMore: 1_000_000,
  composerInput: 1_000_001,
  composerToolbar: 1_000_002,
} as const;

export const getCommentFocusIds = (commentId: string) => ({
  region: `screenshot-comment:${commentId}`,
  upvote: `screenshot-comment-upvote:${commentId}`,
  downvote: `screenshot-comment-downvote:${commentId}`,
  more: `screenshot-comment-more:${commentId}`,
});
