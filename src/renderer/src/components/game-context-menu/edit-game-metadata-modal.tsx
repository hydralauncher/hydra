import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@renderer/hooks";
import { LibraryGame } from "@types";
import { Modal, TextField, Button } from "@renderer/components";

interface EditGameMetadataModalProps {
  visible: boolean;
  onClose: () => void;
  game: LibraryGame | null;
  onSave: (gameId: string, metadata: GameMetadata) => void;
}

interface GameMetadata {
  title: string;
  userDescription: string | null;
  userReleaseDate: Date | null;
  userDeveloper: string | null;
  userPublisher: string | null;
  userRating: number | null;
  userScreenshots: string[] | null;
  hasManuallyUpdatedMetadata: boolean;
}

export function EditGameMetadataModal({
  visible,
  onClose,
  game,
  onSave,
}: EditGameMetadataModalProps) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [userDescription, setUserDescription] = useState("");
  const [userReleaseDate, setUserReleaseDate] = useState("");
  const [userDeveloper, setUserDeveloper] = useState("");
  const [userPublisher, setUserPublisher] = useState("");
  const [userRating, setUserRating] = useState("");
  const [userScreenshots, setUserScreenshots] = useState<string[]>([]);

  useEffect(() => {
    if (visible && game) {
      setTitle(game.title || "");
      setUserDescription(game.userDescription || "");
      setUserReleaseDate(game.userReleaseDate ? new Date(game.userReleaseDate).toISOString().split("T")[0] : "");
      setUserDeveloper(game.userDeveloper || "");
      setUserPublisher(game.userPublisher || "");
      setUserRating(game.userRating ? game.userRating.toString() : "");
      setUserScreenshots(game.userScreenshots || []);
    } else if (!visible) {
      setTitle("");
      setUserDescription("");
      setUserReleaseDate("");
      setUserDeveloper("");
      setUserPublisher("");
      setUserRating("");
      setUserScreenshots([]);
    }
  }, [visible, game]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!game) return;

    if (!title.trim()) {
      showErrorToast(t("edit_game_modal_fill_required"));
      return;
    }

    setIsSaving(true);

    try {
      const metadata: GameMetadata = {
        title: title.trim(),
        userDescription: userDescription.trim() || null,
        userReleaseDate: userReleaseDate ? new Date(userReleaseDate) : null,
        userDeveloper: userDeveloper.trim() || null,
        userPublisher: userPublisher.trim() || null,
        userRating: userRating ? parseFloat(userRating) : null,
        userScreenshots: userScreenshots.length > 0 ? userScreenshots : null,
        hasManuallyUpdatedMetadata: true,
      };

      onSave(game.id, metadata);
      showSuccessToast(t("edit_game_modal_success"));
      handleClose();
    } catch (error) {
      showErrorToast(t("edit_game_modal_failed"));
    } finally {
      setIsSaving(false);
    }
  }, [game, title, userDescription, userReleaseDate, userDeveloper, userPublisher, userRating, userScreenshots, onSave, showSuccessToast, showErrorToast, t, handleClose]);

  const handleAddScreenshot = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        const newScreenshots = Array.from(files).map((file) => URL.createObjectURL(file));
        setUserScreenshots((prev) => [...prev, ...newScreenshots]);
      }
    };
    input.click();
  }, []);

  const handleRemoveScreenshot = useCallback((index: number) => {
    setUserScreenshots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      title={t("edit_game_modal_title")}
      description={t("edit_game_modal_description")}
      onClose={handleClose}
    >
      <div className="edit-game-metadata-modal">
        <div className="edit-game-metadata-modal__field">
          <TextField
            label={t("edit_game_modal_title")}
            placeholder={t("edit_game_modal_enter_title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            theme="dark"
            maxLength={200}
          />
        </div>

        <div className="edit-game-metadata-modal__field">
          <label className="edit-game-metadata-modal__label">{t("edit_game_modal_description")}</label>
          <textarea
            className="edit-game-metadata-modal__textarea"
            placeholder={t("edit_game_modal_enter_description")}
            value={userDescription}
            onChange={(e) => setUserDescription(e.target.value)}
            rows={4}
            maxLength={2000}
          />
        </div>

        <div className="edit-game-metadata-modal__field">
          <TextField
            label={t("edit_game_modal_release_date")}
            type="date"
            value={userReleaseDate}
            onChange={(e) => setUserReleaseDate(e.target.value)}
            theme="dark"
          />
        </div>

        <div className="edit-game-metadata-modal__field">
          <TextField
            label={t("edit_game_modal_developer")}
            placeholder={t("edit_game_modal_enter_developer")}
            value={userDeveloper}
            onChange={(e) => setUserDeveloper(e.target.value)}
            theme="dark"
            maxLength={200}
          />
        </div>

        <div className="edit-game-metadata-modal__field">
          <TextField
            label={t("edit_game_modal_publisher")}
            placeholder={t("edit_game_modal_enter_publisher")}
            value={userPublisher}
            onChange={(e) => setUserPublisher(e.target.value)}
            theme="dark"
            maxLength={200}
          />
        </div>

        <div className="edit-game-metadata-modal__field">
          <TextField
            label={t("edit_game_modal_rating")}
            placeholder={t("edit_game_modal_enter_rating")}
            type="number"
            step="0.1"
            min="0"
            max="10"
            value={userRating}
            onChange={(e) => setUserRating(e.target.value)}
            theme="dark"
          />
        </div>

        <div className="edit-game-metadata-modal__field">
          <label className="edit-game-metadata-modal__label">{t("edit_game_modal_screenshots")}</label>
          <div className="edit-game-metadata-modal__screenshots">
            {userScreenshots.map((screenshot, index) => (
              <div key={index} className="edit-game-metadata-modal__screenshot-item">
                <img src={screenshot} alt={`${t("edit_game_modal_screenshot")} ${index + 1}`} />
                <button
                  type="button"
                  className="edit-game-metadata-modal__remove-screenshot"
                  onClick={() => handleRemoveScreenshot(index)}
                  aria-label={t("edit_game_modal_remove_screenshot")}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="edit-game-metadata-modal__add-screenshot"
              onClick={handleAddScreenshot}
            >
              + {t("edit_game_modal_add_screenshot")}
            </button>
          </div>
        </div>

        <div className="edit-game-metadata-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={handleClose}
            disabled={isSaving}
          >
            {t("cancel")}
          </Button>

          <Button
            type="button"
            theme="primary"
            onClick={handleSave}
            disabled={isSaving || !title.trim()}
          >
            {isSaving ? t("edit_game_modal_saving") : t("edit_game_modal_save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}