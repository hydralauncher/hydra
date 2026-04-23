export const IS_BROWSER =
  typeof globalThis.self !== "undefined" &&
  typeof Window !== "undefined" &&
  globalThis.self instanceof Window;

export const IS_DESKTOP = IS_BROWSER && !!globalThis.window.electron;
