import { Button, Modal, TextField } from "@renderer/components";
import { UserProfile } from "@types";
import * as styles from "./user.css";
import { PencilIcon, PersonIcon } from "@primer/octicons-react";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useState } from "react";
import { useToast, useUserDetails } from "@renderer/hooks";

export interface UserEditProfileModalProps {
  userProfile: UserProfile;
  visible: boolean;
  onClose: () => void;
  updateUser: () => Promise<void>;
}

export const UserEditProfileModal = ({
  userProfile,
  visible,
  onClose,
  updateUser,
}: UserEditProfileModalProps) => {
  const [displayName, setDisplayName] = useState(userProfile.displayName);
  const [newImagePath, setNewImagePath] = useState<string | null>(null);
  const [newImageBase64, setNewImageBase64] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { patchUser } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const handleChangeProfileAvatar = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Profile image",
          extensions: ["jpg", "png", "gif", "webp", "jpeg"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];

      window.electron.imagePathToBase64(path).then((base64) => {
        setNewImageBase64(base64);
      });

      setNewImagePath(path);
    }
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    patchUser(displayName, newImagePath)
      .then(() => {
        updateUser();
        showSuccessToast("Salvo com sucesso");
        cleanFormAndClose();
      })
      .catch(() => {
        showErrorToast("Tente novamente");
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const resetModal = () => {
    setDisplayName(userProfile.displayName);
    setNewImagePath(null);
    setNewImageBase64(null);
  };

  const cleanFormAndClose = () => {
    resetModal();
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        title="Editar Perfil"
        onClose={cleanFormAndClose}
      >
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: `${SPACING_UNIT * 3}px`,
            width: "350px",
          }}
        >
          <button
            className={styles.profileAvatarEditContainer}
            onClick={handleChangeProfileAvatar}
          >
            {userProfile.profileImageUrl ? (
              <img
                className={styles.profileAvatar}
                alt={userProfile.displayName}
                src={newImageBase64 ?? userProfile.profileImageUrl}
              />
            ) : (
              <PersonIcon size={72} />
            )}
            <div className={styles.editProfileImageBadge}>
              <PencilIcon size={16} />
            </div>
          </button>

          <TextField
            label="Nome de exibição"
            value={displayName}
            containerProps={{ style: { width: "100%" } }}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button
            disabled={isSaving}
            style={{ alignSelf: "end" }}
            onClick={handleSaveProfile}
          >
            {isSaving ? "Salvando..." : "Salvar"}
          </Button>
        </section>
      </Modal>
    </>
  );
};
