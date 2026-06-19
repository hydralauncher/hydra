import type { LibraryGame } from "@types";
import { GameSettingsModal } from "../game";
import { useGameSettingsModalState } from "../game/game-settings-modal/use-game-settings-modal-state";
import { useGameDetails } from "../../../hooks";

interface LibraryGameSettingsModalProps {
  visible: boolean;
  game: LibraryGame | null;
  onClose: () => void;
}

export function LibraryGameSettingsModal({
  visible,
  game,
  onClose,
}: Readonly<LibraryGameSettingsModalProps>) {
  const objectId = game?.objectId ?? "";
  const shop = game?.shop ?? "steam";
  const {
    game: detailedGame,
    updateGame,
    refreshGameDetails,
  } = useGameDetails(objectId, shop);
  const modalGame = detailedGame ?? game;
  const { launchSettings, customizationSettings, cloudSettings } =
    useGameSettingsModalState({
      game: modalGame,
      visible,
      updateGame,
      refreshGameDetails,
    });

  if (
    !visible ||
    !modalGame ||
    !launchSettings ||
    !customizationSettings ||
    !cloudSettings
  ) {
    return null;
  }

  return (
    <GameSettingsModal
      visible={visible}
      game={modalGame}
      launchSettings={launchSettings}
      customizationSettings={customizationSettings}
      cloudSettings={cloudSettings}
      onClose={onClose}
    />
  );
}
