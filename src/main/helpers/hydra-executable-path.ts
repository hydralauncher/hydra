const getSnapExecutablePath = () => {
  const snapInstanceName = process.env.SNAP_INSTANCE_NAME;

  if (!snapInstanceName) return null;

  const snapName = process.env.SNAP_NAME ?? snapInstanceName.split("_")[0];
  const snapAppName = process.env.SNAP_APP_NAME ?? snapName;
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
