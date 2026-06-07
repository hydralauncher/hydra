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
          "Windows Defender exclusion added successfully!"
        )
      );
    } catch (err: unknown) {
      showErrorToast(
        getErrorMessage(err) ||
          t(
            "windows_defender_exclusion_error",
            "Error adding Windows Defender exclusion."
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
          "Windows Defender exclusion removed successfully!"
        )
      );
    } catch (err: unknown) {
      showErrorToast(
        getErrorMessage(err) ||
          t(
            "windows_defender_exclusion_removed_error",
            "Error removing Windows Defender exclusion."
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
            "Windows Defender exclusion folder has been updated!"
          )
        );
      } catch (err: unknown) {
        showErrorToast(
          getErrorMessage(err) ||
            t(
              "windows_defender_exclusion_updated_error",
              "Error updating Windows Defender exclusion."
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
          "Remove Windows Defender Exclusion"
        )
      : t(
          "add_windows_defender_exclusion",
          "Add Windows Defender Exclusion"
        ),
  };
}
