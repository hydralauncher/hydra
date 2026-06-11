import { useTranslation } from "react-i18next";
import { FileDirectoryIcon, PlusIcon, XIcon } from "@primer/octicons-react";

import { Button, CheckboxField } from "@renderer/components";
import type { EmulatorSystem } from "@types";

import type { PendingFolder } from "./types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  folders: PendingFolder[];
  ymlEntryCount?: number;
  onAddFolder: () => void;
  onChangeFolder: (index: number) => void;
  onRemoveFolder: (index: number) => void;
  onToggleSubfolders: (index: number) => void;
}

export function SetupStepRomFolder({
  systemLabel,
  folders,
  ymlEntryCount = 0,
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

      {ymlEntryCount > 0 && (
        <p className="setup-modal__body-intro">
          {t(
            ymlEntryCount === 1
              ? "setup_rom_yml_registered_one"
              : "setup_rom_yml_registered_other",
            { count: ymlEntryCount }
          )}
        </p>
      )}

      <div className="setup-modal__folder-list">
        {!hasFolders && (
          <div className="setup-modal__rom-card">
            <div className="setup-modal__rom-card-top">
              <div className="setup-modal__rom-card-text">
                <span className="setup-modal__rom-card-title">
                  {t("setup_rom_none_yet")}
                </span>
                <span className="setup-modal__rom-card-subtitle">
                  {t("setup_rom_choose_hint", { system: systemLabel })}
                </span>
              </div>
              <Button theme="primary" onClick={onAddFolder}>
                <FileDirectoryIcon size={14} />
                <span>{t("setup_rom_browse")}</span>
              </Button>
            </div>
            <div className="setup-modal__rom-card-subfolder setup-modal__rom-card-subfolder--disabled">
              <CheckboxField
                label={t("scan_subfolders")}
                checked={false}
                disabled
                readOnly
              />
              <span className="setup-modal__rom-card-subfolder-hint">
                {t("setup_rom_subfolder_hint")}
              </span>
            </div>
          </div>
        )}

        {hasFolders &&
          folders.map((folder, index) => (
            <div className="setup-modal__rom-card" key={folder.path}>
              <div className="setup-modal__rom-card-top">
                <div className="setup-modal__rom-card-text">
                  <span className="setup-modal__rom-card-title">
                    {folder.path}
                  </span>
                  {folder.previewCount !== null && (
                    <span className="setup-modal__rom-card-subtitle">
                      {t(
                        folder.previewCount === 1
                          ? "setup_rom_files_found_one"
                          : "setup_rom_files_found_other",
                        { count: folder.previewCount, system: systemLabel }
                      )}
                    </span>
                  )}
                </div>
                <Button theme="primary" onClick={() => onChangeFolder(index)}>
                  <FileDirectoryIcon size={14} />
                  <span>{t("setup_rom_browse")}</span>
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
              <div className="setup-modal__rom-card-subfolder">
                <CheckboxField
                  label={t("scan_subfolders")}
                  checked={folder.scanSubfolders}
                  onChange={() => onToggleSubfolders(index)}
                />
                <span className="setup-modal__rom-card-subfolder-hint">
                  {t("setup_rom_subfolder_hint")}
                </span>
              </div>
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
    </>
  );
}
