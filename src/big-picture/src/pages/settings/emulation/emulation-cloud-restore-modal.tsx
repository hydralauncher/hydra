import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  MemcardRestoreTarget,
} from "@types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../../components";
import { useNavigation } from "../../../hooks";
import {
  getEmulationCloudRestoreButtonNavigationOverrides,
  getEmulationCloudRestoreTargetFocusId,
  getEmulationCloudRestoreTargetNavigationOverrides,
} from "../settings-navigation";
import { basename } from "./shared";

const PICK_FILTERS: Record<
  EmulationSavePlatform,
  { name: string; extensions: string[] }
> = {
  ps1: {
    name: "PS1 Memory Card",
    extensions: ["mcd", "mcr", "mc", "gme", "vgs", "vmp"],
  },
  ps2: { name: "PS2 Memory Card", extensions: ["ps2", "mcd", "mc2"] },
};

interface EmulationCloudRestoreModalProps {
  save: EmulationCloudSave | null;
  platform: EmulationSavePlatform;
  onClose: () => void;
  onRestored: () => void;
  onRestoreSuccess: () => void;
  onRestoreError: () => void;
  regionId: string;
  actionsRegionId: string;
  pickButtonId: string;
  confirmButtonId: string;
  modalClassName?: string;
  formatPickedPathLabel?: (path: string) => string;
}

export function EmulationCloudRestoreModal({
  save,
  platform,
  onClose,
  onRestored,
  onRestoreSuccess,
  onRestoreError,
  regionId,
  actionsRegionId,
  pickButtonId,
  confirmButtonId,
  modalClassName,
  formatPickedPathLabel = basename,
}: Readonly<EmulationCloudRestoreModalProps>) {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigation();
  const [targets, setTargets] = useState<MemcardRestoreTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!save) return;

    void globalThis.window.electron
      .getMemcardRestoreTargets(platform)
      .then((foundTargets) => {
        setTargets(foundTargets);
        setSelectedTarget(foundTargets[0]?.cardFilePath ?? null);
      });
  }, [platform, save]);

  useEffect(() => {
    if (!save) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(
        selectedTarget
          ? getEmulationCloudRestoreTargetFocusId(selectedTarget)
          : pickButtonId
      );
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [pickButtonId, save, selectedTarget, setFocus]);

  const handlePickFile = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [PICK_FILTERS[platform]],
    });

    if (result.canceled || result.filePaths.length === 0) return;

    const chosenPath = result.filePaths[0];
    setTargets((current) =>
      current.some((target) => target.cardFilePath === chosenPath)
        ? current
        : [
            ...current,
            {
              cardFilePath: chosenPath,
              cardLabel: formatPickedPathLabel(chosenPath),
            },
          ]
    );
    setSelectedTarget(chosenPath);
  }, [formatPickedPathLabel, platform]);

  const handleRestore = useCallback(async () => {
    if (!save || !selectedTarget) return;

    setIsBusy(true);

    try {
      const result = await globalThis.window.electron.restoreEmulationSave(
        platform,
        save.id,
        selectedTarget
      );

      if (result.ok) {
        onRestoreSuccess();
        onRestored();
        onClose();
      } else {
        onRestoreError();
      }
    } finally {
      setIsBusy(false);
    }
  }, [
    onClose,
    onRestored,
    onRestoreError,
    onRestoreSuccess,
    platform,
    save,
    selectedTarget,
  ]);

  return (
    <Modal
      visible={save !== null}
      title={t("cloud_restore_title")}
      description={t("cloud_restore_description")}
      onClose={onClose}
      className={modalClassName}
    >
      <VerticalFocusGroup
        regionId={regionId}
        className="emu-save-modal__restore"
      >
        <div className="emu-save-modal__targets">
          {targets.length === 0 ? (
            <div className="emu-save-modal__empty">
              {t("cloud_restore_no_cards")}
            </div>
          ) : (
            targets.map((target) => {
              const targetId = getEmulationCloudRestoreTargetFocusId(
                target.cardFilePath
              );
              const isSelected = selectedTarget === target.cardFilePath;

              return (
                <FocusItem
                  key={target.cardFilePath}
                  id={targetId}
                  navigationOverrides={getEmulationCloudRestoreTargetNavigationOverrides(
                    {
                      cardFilePath: target.cardFilePath,
                      firstCardFilePath: targets[0]?.cardFilePath,
                      lastCardFilePath: targets.at(-1)?.cardFilePath,
                      pickButtonId,
                    }
                  )}
                  asChild
                >
                  <button
                    type="button"
                    className={`emu-save-modal__target${
                      isSelected ? " emu-save-modal__target--selected" : ""
                    }`}
                    onClick={() => setSelectedTarget(target.cardFilePath)}
                  >
                    <span className="emu-save-modal__target-name">
                      {target.cardLabel}
                    </span>
                    <span className="emu-save-modal__target-path">
                      {target.cardFilePath}
                    </span>
                  </button>
                </FocusItem>
              );
            })
          )}
        </div>

        <HorizontalFocusGroup
          regionId={actionsRegionId}
          className="emu-save-modal__actions"
        >
          <Button
            focusId={pickButtonId}
            focusNavigationOverrides={getEmulationCloudRestoreButtonNavigationOverrides(
              selectedTarget
            )}
            variant="secondary"
            disabled={isBusy}
            onClick={handlePickFile}
          >
            {t("cloud_restore_pick_file")}
          </Button>
          <Button
            focusId={confirmButtonId}
            focusNavigationOverrides={getEmulationCloudRestoreButtonNavigationOverrides(
              selectedTarget
            )}
            loading={isBusy}
            disabled={!selectedTarget}
            onClick={handleRestore}
          >
            {t("cloud_restore_confirm")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
