const getSnapExecutablePath = () => {
  const snapInstanceName = process.env.SNAP_INSTANCE_NAME;
  const snapAppName = process.env.SNAP_APP_NAME;

  if (!snapInstanceName || !snapAppName) return null;

  const snapName = snapInstanceName.split("_")[0];
  const commandName =
    snapAppName === snapName
      ? snapInstanceName
      : `${snapInstanceName}.${snapAppName}`;

  return `/snap/bin/${commandName}`;
};

export const getHydraExecutablePath = () =>
  process.env.APPIMAGE ||
  process.env.PORTABLE_EXECUTABLE_FILE ||
  getSnapExecutablePath() ||
  process.execPath;
