export const removeAppImageLibraryPath = () => {
  const { APPIMAGE, APPDIR, LD_LIBRARY_PATH } = process.env;
  if (!APPIMAGE || !APPDIR || LD_LIBRARY_PATH === undefined) return;

  const remainingEntries = LD_LIBRARY_PATH.split(":").filter(
    (entry) => entry && entry !== `${APPDIR}/usr/lib`
  );

  if (remainingEntries.length > 0) {
    process.env.LD_LIBRARY_PATH = remainingEntries.join(":");
  } else {
    delete process.env.LD_LIBRARY_PATH;
  }
};
