import { useTranslation } from "react-i18next";
import { FileDirectoryIcon, PlusIcon, XIcon } from "@primer/octicons-react";

import { Button, CheckboxField } from "@renderer/components";
import type { EmulatorSystem } from "@types";

import type { PendingFolder } from "./types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  folders: PendingFolder[];
  onAddFolder: () => void;
  onChangeFolder: (index: number) => void;
  onRemoveFolder: (index: number) => void;
  onToggleSubfolders: (index: number) => void;
}

export function SetupStepRomFolder({
  systemLabel,
  folders,
  onAddFolder,
  onChangeFolder,
  onRemoveFolder,
  onToggleSubfolders,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const hasFolders = folders.length > 0;

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_step_rom_folder", { system: systemLabel })}
      </h3>
      <p className="setup-modal__body-intro">
        {t("setup_rom_intro", { system: systemLabel })}
      </p>

      {!hasFolders && (
        <div className="setup-modal__row-card">
          <div className="setup-modal__row-icon setup-modal__row-icon--folder">
            <FileDirectoryIcon size={18} />
          </div>
          <div className="setup-modal__row-text">
            <span className="setup-modal__row-title">
              {t("setup_rom_none_yet")}
            </span>
            <span className="setup-modal__row-description">
              {t("setup_rom_choose_hint", { system: systemLabel })}
            </span>
          </div>
          <Button theme="primary" onClick={onAddFolder}>
            <FileDirectoryIcon size={14} />
            <span>{t("setup_rom_browse")}</span>
          </Button>
        </div>
      )}

      {hasFolders && (
        <div className="setup-modal__folder-list">
          {folders.map((folder, index) => (
            <div className="setup-modal__row-card" key={folder.path}>
              <div className="setup-modal__row-icon setup-modal__row-icon--folder">
                <FileDirectoryIcon size={18} />
              </div>
              <div className="setup-modal__row-text">
                <span className="setup-modal__row-path">{folder.path}</span>
                {folder.previewCount !== null && (
                  <span className="setup-modal__row-description">
                    {t(
                      folder.previewCount === 1
                        ? "setup_rom_files_found_one"
                        : "setup_rom_files_found_other",
                      { count: folder.previewCount, system: systemLabel }
                    )}
                  </span>
                )}
                <CheckboxField
                  label={t("scan_subfolders")}
                  checked={folder.scanSubfolders}
                  onChange={() => onToggleSubfolders(index)}
                />
              </div>
              <Button theme="outline" onClick={() => onChangeFolder(index)}>
                {t("setup_rom_change")}
              </Button>
              {folders.length > 1 && (
                <button
                  type="button"
                  className="setup-modal__ghost-button"
                  aria-label="remove"
                  onClick={() => onRemoveFolder(index)}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="setup-modal__add-folder"
            onClick={onAddFolder}
          >
            <PlusIcon size={14} />
            <span>{t("setup_rom_add_another")}</span>
          </button>
        </div>
      )}
    </>
  );
}
