import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "./use-toast";

interface UseWindowsDefenderExclusionOptions {
  downloadsPath: string;
  hasExclusion: boolean;
  onPreferenceChange: (values: Record<string, unknown>) => void;
}

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
};

export function useWindowsDefenderExclusion({
  downloadsPath,
  hasExclusion,
  onPreferenceChange,
}: UseWindowsDefenderExclusionOptions) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const isWindows = window.electron.platform === "win32";

  const handleAddExclusion = useCallback(async () => {
    try {
      await window.electron.addWindowsDefenderExclusion(downloadsPath);
      onPreferenceChange({ hasWindowsDefenderExclusion: true });
      showSuccessToast(
        t(
          "windows_defender_exclusion_success",
          "Exclusion Windows Defender ajoutée avec succès !"
        )
      );
    } catch (err: unknown) {
      showErrorToast(
        getErrorMessage(err) ||
          t(
            "windows_defender_exclusion_error",
            "Erreur lors de l'ajout de l'exclusion Windows Defender."
          )
      );
    }
  }, [downloadsPath, onPreferenceChange, showSuccessToast, showErrorToast, t]);

  const handleRemoveExclusion = useCallback(async () => {
    try {
      await window.electron.removeWindowsDefenderExclusion(downloadsPath);
      onPreferenceChange({ hasWindowsDefenderExclusion: false });
      showSuccessToast(
        t(
          "windows_defender_exclusion_removed_success",
          "Exclusion Windows Defender retirée avec succès !"
        )
      );
    } catch (err: unknown) {
      showErrorToast(
        getErrorMessage(err) ||
          t(
            "windows_defender_exclusion_removed_error",
            "Erreur lors du retrait de l'exclusion Windows Defender."
          )
      );
    }
  }, [downloadsPath, onPreferenceChange, showSuccessToast, showErrorToast, t]);

  const handleToggleExclusion = useCallback(async () => {
    if (hasExclusion) {
      await handleRemoveExclusion();
    } else {
      await handleAddExclusion();
    }
  }, [hasExclusion, handleAddExclusion, handleRemoveExclusion]);

  const syncExclusionOnPathChange = useCallback(
    async (oldPath: string, newPath: string) => {
      if (!hasExclusion || newPath === oldPath || !oldPath) return;

      try {
        await window.electron.updateWindowsDefenderExclusion(oldPath, newPath);
        showSuccessToast(
          t(
            "windows_defender_exclusion_updated_success",
            "Le dossier d'exclusion Windows Defender a été mis à jour !"
          )
        );
      } catch (err: unknown) {
        showErrorToast(
          getErrorMessage(err) ||
            t(
              "windows_defender_exclusion_updated_error",
              "Erreur lors de la mise à jour de l'exclusion Windows Defender."
            )
        );
      }
    },
    [hasExclusion, showSuccessToast, showErrorToast, t]
  );

  return {
    isWindows,
    hasExclusion,
    handleToggleExclusion,
    syncExclusionOnPathChange,
    exclusionButtonLabel: hasExclusion
      ? t(
          "remove_windows_defender_exclusion",
          "Retirer l'exclusion Windows Defender"
        )
      : t(
          "add_windows_defender_exclusion",
          "Ajouter une exclusion Windows Defender"
        ),
  };
}
