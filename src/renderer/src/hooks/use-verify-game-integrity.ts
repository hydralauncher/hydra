import { useTranslation } from "react-i18next";
import { useToast } from "./use-toast";
import type { Game, GameRepack } from "@types";

export function useVerifyGameIntegrity() {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();

  const verifyIntegrity = async (
    game: Game,
    repacks: GameRepack[] = [],
    customDownloadPath?: string | null
  ) => {
    try {
      const uri = game.download?.uri || repacks?.[0]?.uris?.[0];
      const downloadPath = customDownloadPath || game.download?.downloadPath;

      if (!uri)
        throw new Error(
          t("no_repacks_found", "No source found for this game.")
        );
      if (!downloadPath)
        throw new Error(
          t("no_download_path", "Please select a download folder.")
        );

      await window.electron.verifyGameIntegrity(
        game.shop,
        game.objectId,
        uri,
        downloadPath
      );
      showSuccessToast(
        t(
          "verify_integrity_success",
          "Verification started successfully. Check the downloads bar."
        )
      );
    } catch (err: any) {
      showErrorToast(
        err?.message ||
          t("verify_integrity_error", "Error during verification.")
      );
    }
  };

  return { verifyIntegrity };
}
