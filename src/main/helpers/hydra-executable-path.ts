export const getHydraExecutablePath = () =>
  process.env.APPIMAGE ||
  process.env.PORTABLE_EXECUTABLE_FILE ||
  process.execPath;
