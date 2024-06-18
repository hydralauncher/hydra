import { Button, Modal, TextField } from "@renderer/components";
import { UserProfile } from "@types";
import * as styles from "./user.css";
import { PersonIcon } from "@primer/octicons-react";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useState } from "react";
import { useToast } from "@renderer/hooks";

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
    window.electron
      .updateProfile(displayName, newImagePath)
      .then(() => {
        updateUser();
        setNewImagePath(null);
        showSuccessToast("Sucesso");
        onClose();
      })
      .catch(() => {
        showErrorToast("Erro");
      });
  };
  return (
    <>
      <Modal visible={visible} title="Editar Perfil" onClose={onClose}>
        <section
          style={{
            padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: `${SPACING_UNIT * 3}px`,
            width: "300px",
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
          </button>

          <TextField
            label="Nome de exibição"
            value={displayName}
            containerProps={{ style: { width: "100%" } }}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button style={{ alignSelf: "end" }} onClick={handleSaveProfile}>
            Salvar{" "}
          </Button>
        </section>
      </Modal>
    </>
  );
};
