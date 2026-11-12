import type { LibraryGame } from "@types";

type DownloadLibraryReader = (
  includeConcealed?: boolean
) => Promise<Array<Pick<LibraryGame, "download">>>;

export async function readActiveLibraryDownload(
  getLibrary: DownloadLibraryReader
) {
  const library = await getLibrary(true);

  return library.some(({ download }) =>
    Boolean(
      download &&
        (download.status === "active" ||
          download.status === "extracting" ||
          download.extracting)
    )
  );
}
