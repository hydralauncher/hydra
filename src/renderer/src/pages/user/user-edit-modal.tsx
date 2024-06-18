import { Button, Modal, TextField } from "@renderer/components";
import { UserProfile } from "@types";
import * as styles from "./user.css";
import { PersonIcon } from "@primer/octicons-react";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useState } from "react";

export interface UserEditProfileModalProps {
  userProfile: UserProfile;
  visible: boolean;
  onClose: () => void;
}

export const UserEditProfileModal = ({
  userProfile,
  visible,
  onClose,
}: UserEditProfileModalProps) => {
  const [displayName, setDisplayName] = useState(userProfile.displayName);
  const [newImagePath, setNewImagePath] = useState<string | null>(null);

  const handleChangeProfileAvatar = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Profile avatar",
          extensions: ["jpg", "png", "gif"],
        },
      ],
    });

    const path = filePaths[0];
    console.log(path);

    setNewImagePath(path);
  };

  const handleSaveProfile = async () => {
    await window.electron
      .updateProfile(displayName, newImagePath)
      .catch((err) => {
        console.log("errro", err);
      });
    setNewImagePath(null);
    onClose();
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
                src={newImagePath ?? userProfile.profileImageUrl}
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
