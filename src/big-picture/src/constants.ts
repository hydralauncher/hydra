export const IS_BROWSER =
  globalThis.self !== undefined &&
  globalThis.Window !== undefined &&
  globalThis.self instanceof globalThis.Window;

export const IS_DESKTOP = IS_BROWSER && !!globalThis.window.electron;
