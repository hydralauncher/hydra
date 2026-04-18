export const IS_BROWSER =
  typeof self !== "undefined" &&
  typeof Window !== "undefined" &&
  self instanceof Window;

export const IS_DESKTOP = IS_BROWSER && !!window.electron;
