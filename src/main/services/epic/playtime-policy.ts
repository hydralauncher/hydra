export const resolveEpicSessionPlaytimePolicy = (
  activeImport: boolean,
  confirmedInstall: boolean,
  enableHydra: boolean
) => ({
  countHydraPlaytime: !activeImport || !confirmedInstall || enableHydra,
  syncEpicOnExit: activeImport && confirmedInstall,
});
