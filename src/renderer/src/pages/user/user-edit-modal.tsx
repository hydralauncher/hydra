import { Button, Modal, TextField } from "@renderer/components";
import { UserProfile } from "@types";
import * as styles from "./user.css";
import { DeviceCameraIcon, PersonIcon } from "@primer/octicons-react";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useEffect, useMemo, useState } from "react";
import { useToast, useUserDetails } from "@renderer/hooks";

export interface UserEditProfileModalProps {
  userProfile: UserProfile;
  visible: boolean;
  onClose: () => void;
  updateUserProfile: () => Promise<void>;
}

export const UserEditProfileModal = ({
  userProfile,
  visible,
  onClose,
  updateUserProfile,
}: UserEditProfileModalProps) => {
  const [displayName, setDisplayName] = useState("");
  const [newImagePath, setNewImagePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { patchUser } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  useEffect(() => {
    setDisplayName(userProfile.displayName);
  }, [userProfile.displayName]);

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

      setNewImagePath(path);
    }
  };

  const handleSaveProfile: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    setIsSaving(true);

    patchUser(displayName, newImagePath)
      .then(async () => {
        await updateUserProfile();
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
  };

  const cleanFormAndClose = () => {
    resetModal();
    onClose();
  };

  const avatarUrl = useMemo(() => {
    if (newImagePath) return `local:${newImagePath}`;
    if (userProfile.profileImageUrl) return userProfile.profileImageUrl;
    return null;
  }, [newImagePath, userProfile.profileImageUrl]);

  return (
    <>
      <Modal
        visible={visible}
        title="Editar Perfil"
        onClose={cleanFormAndClose}
      >
        <form
          onSubmit={handleSaveProfile}
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
            type="button"
            className={styles.profileAvatarEditContainer}
            onClick={handleChangeProfileAvatar}
          >
            {avatarUrl ? (
              <img
                className={styles.profileAvatar}
                alt={userProfile.displayName}
                src={avatarUrl}
              />
            ) : (
              <PersonIcon size={96} />
            )}
            <div className={styles.editProfileImageBadge}>
              <DeviceCameraIcon size={16} />
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
            type="submit"
          >
            {isSaving ? "Salvando…" : "Salvar"}
          </Button>
        </form>
      </Modal>
    </>
  );
};
