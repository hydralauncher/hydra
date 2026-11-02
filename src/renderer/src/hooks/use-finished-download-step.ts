import type { LibraryGame } from "@types";
import { getFinishedDownloadStep, type FinishedDownloadStep } from "@shared";
import { useInstallerAvailability } from "./use-installer-availability";
import { useDownloadFolderExists } from "./use-download-folder-exists";

export type GamePageDownloadStep = FinishedDownloadStep | "checking";

export function useFinishedDownloadStep(
  game: LibraryGame | null | undefined
): GamePageDownloadStep | null {
  const installerAvailability = useInstallerAvailability(game ? [game] : []);
  const downloadFolderExists = useDownloadFolderExists(game);

  if (!game || downloadFolderExists === false) return null;

  const step = getFinishedDownloadStep(
    game,
    installerAvailability[game.id] === true
  );

  const isStillLoading =
    !(game.id in installerAvailability) || downloadFolderExists === null;

  if (step === "select-executable" && isStillLoading) return "checking";

  return step;
}
