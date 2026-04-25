import type {
  CreateSteamShortcutOptions,
  GameArtifact,
  LibraryGame,
} from "@types";
import { formatBytes } from "@shared";
import { useMemo, useState } from "react";
import {
  Button,
  HorizontalFocusGroup,
  Modal,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../../common";
import type { useGameSettingsCloudSync } from "./use-game-settings-cloud-sync";
import { FocusableInput, ToggleAction } from "./shared";

export function ConfirmationModal({
  visible,
  title,
  description,
  confirmLabel,
  danger = false,
  onClose,
  onConfirm,
}: Readonly<{
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}>) {
  return (
    <Modal
      visible={visible}
      onClose={onClose}
      className="game-settings-modal__submodal"
    >
      <NavigationLayer>
        <VerticalFocusGroup>
          <div className="game-settings-modal__submodal-content">
            <h2>{title}</h2>
            <p>{description}</p>
            <HorizontalFocusGroup className="game-settings-modal__actions">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                onClick={async () => {
                  await onConfirm();
                  onClose();
                }}
              >
                {confirmLabel}
              </Button>
            </HorizontalFocusGroup>
          </div>
        </VerticalFocusGroup>
      </NavigationLayer>
    </Modal>
  );
}

export function CreateSteamShortcutModal({
  visible,
  creating,
  onClose,
  onConfirm,
}: Readonly<{
  visible: boolean;
  creating: boolean;
  onClose: () => void;
  onConfirm: (options: CreateSteamShortcutOptions) => Promise<void>;
}>) {
  const [openVr, setOpenVr] = useState(false);

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      className="game-settings-modal__submodal"
    >
      <NavigationLayer>
        <VerticalFocusGroup>
          <div className="game-settings-modal__submodal-content">
            <h2>Create Steam shortcut</h2>
            <ToggleAction
              label="Launch with OpenVR"
              checked={openVr}
              disabled={creating}
              onToggle={() => setOpenVr((value) => !value)}
            />
            <HorizontalFocusGroup className="game-settings-modal__actions">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={creating}
                onClick={async () => {
                  await onConfirm({ openVr });
                  onClose();
                }}
              >
                Create
              </Button>
            </HorizontalFocusGroup>
          </div>
        </VerticalFocusGroup>
      </NavigationLayer>
    </Modal>
  );
}

export function ChangePlaytimeModal({
  visible,
  game,
  onClose,
  onConfirm,
}: Readonly<{
  visible: boolean;
  game: LibraryGame | null;
  onClose: () => void;
  onConfirm: (playtimeInSeconds: number) => Promise<void>;
}>) {
  const totalMinutes = Math.floor((game?.playTimeInMilliseconds ?? 0) / 60_000);
  const [hours, setHours] = useState(
    totalMinutes ? String(Math.floor(totalMinutes / 60)) : ""
  );
  const [minutes, setMinutes] = useState(
    totalMinutes ? String(totalMinutes % 60) : ""
  );

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      className="game-settings-modal__submodal"
    >
      <NavigationLayer>
        <VerticalFocusGroup>
          <div className="game-settings-modal__submodal-content">
            <h2>Update playtime</h2>
            <p>Set the manual playtime for {game?.title ?? "this game"}.</p>
            <div className="game-settings-modal__form-grid">
              <FocusableInput
                label="Hours"
                type="number"
                value={hours}
                onChange={setHours}
                placeholder="0"
              />
              <FocusableInput
                label="Minutes"
                type="number"
                value={minutes}
                onChange={setMinutes}
                placeholder="0"
              />
            </div>
            <HorizontalFocusGroup className="game-settings-modal__actions">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  const totalSeconds =
                    (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
                  await onConfirm(totalSeconds);
                  onClose();
                }}
              >
                Update
              </Button>
            </HorizontalFocusGroup>
          </div>
        </VerticalFocusGroup>
      </NavigationLayer>
    </Modal>
  );
}

export function RenameArtifactModal({
  visible,
  artifact,
  onClose,
  onConfirm,
}: Readonly<{
  visible: boolean;
  artifact: GameArtifact | null;
  onClose: () => void;
  onConfirm: (artifactId: string, label: string) => Promise<void>;
}>) {
  const [label, setLabel] = useState(artifact?.label ?? "");

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      className="game-settings-modal__submodal"
    >
      <NavigationLayer>
        <VerticalFocusGroup>
          <div className="game-settings-modal__submodal-content">
            <h2>Rename backup</h2>
            <FocusableInput
              label="Backup name"
              value={label}
              onChange={setLabel}
              placeholder="Backup name"
            />
            <HorizontalFocusGroup className="game-settings-modal__actions">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!artifact || !label.trim()}
                onClick={async () => {
                  if (!artifact) return;
                  await onConfirm(artifact.id, label.trim());
                  onClose();
                }}
              >
                Save
              </Button>
            </HorizontalFocusGroup>
          </div>
        </VerticalFocusGroup>
      </NavigationLayer>
    </Modal>
  );
}

export function ManageFilesModal({
  visible,
  backupPreview,
  onClose,
  onSetBackupPath,
}: Readonly<{
  visible: boolean;
  backupPreview: ReturnType<typeof useGameSettingsCloudSync>["backupPreview"];
  onClose: () => void;
  onSetBackupPath: (path: string | null) => Promise<void>;
}>) {
  const files = useMemo(() => {
    if (!backupPreview) return [];

    const [gameBackup] = Object.values(backupPreview.games);
    if (!gameBackup) return [];

    return Object.entries(gameBackup.files).map(([path, file]) => ({
      path,
      bytes: file.bytes,
    }));
  }, [backupPreview]);

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      className="game-settings-modal__submodal game-settings-modal__submodal--wide"
    >
      <NavigationLayer>
        <VerticalFocusGroup>
          <div className="game-settings-modal__submodal-content">
            <h2>Manage files</h2>
            <p>Choose automatic mapping or a custom folder for this game.</p>
            <HorizontalFocusGroup className="game-settings-modal__actions">
              <Button variant="secondary" onClick={() => onSetBackupPath(null)}>
                Automatic mapping
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const { filePaths } =
                    await globalThis.window.electron.showOpenDialog({
                      properties: ["openDirectory"],
                    });

                  if (filePaths[0]) await onSetBackupPath(filePaths[0]);
                }}
              >
                Select folder
              </Button>
            </HorizontalFocusGroup>
            <ul className="game-settings-modal__file-list">
              {files.map((file) => (
                <li key={file.path} className="game-settings-modal__file-item">
                  <Button
                    variant="link"
                    onClick={() =>
                      globalThis.window.electron.showItemInFolder(file.path)
                    }
                  >
                    {file.path.split(/[\\/]/).at(-1) ?? file.path}
                  </Button>
                  <span>{formatBytes(file.bytes)}</span>
                </li>
              ))}
            </ul>
          </div>
        </VerticalFocusGroup>
      </NavigationLayer>
    </Modal>
  );
}
