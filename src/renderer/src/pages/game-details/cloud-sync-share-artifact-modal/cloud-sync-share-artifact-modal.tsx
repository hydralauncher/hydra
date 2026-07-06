import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Modal, ModalProps } from "@renderer/components";
import { useTranslation } from "react-i18next";
import type {
  ArtifactShare,
  GameArtifact,
  ProfileFriends,
  UserFriend,
} from "@types";
import { cloudSyncContext } from "@renderer/context";
import { logger } from "@renderer/logger";
import { useToast } from "@renderer/hooks";
import { CheckIcon, XIcon } from "@primer/octicons-react";

import "./cloud-sync-share-artifact-modal.scss";

const FRIENDS_PAGE_SIZE = 100;

export interface CloudSyncShareArtifactModalProps
  extends Omit<ModalProps, "children" | "title"> {
  artifact: GameArtifact | null;
}

export function CloudSyncShareArtifactModal({
  visible,
  onClose,
  artifact,
}: Readonly<CloudSyncShareArtifactModalProps>) {
  const { t } = useTranslation("game_details");

  const { shareGameArtifact, unshareGameArtifact } =
    useContext(cloudSyncContext);

  const { showSuccessToast, showErrorToast } = useToast();

  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [shares, setShares] = useState<ArtifactShare[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingFriendId, setPendingFriendId] = useState<string | null>(null);

  const getShares = useCallback(async () => {
    if (!artifact) return;

    const results = await window.electron.hydraApi
      .get<ArtifactShare[]>(`/profile/games/artifacts/${artifact.id}/shares`)
      .catch(() => []);

    setShares(results);
  }, [artifact]);

  useEffect(() => {
    if (!visible || !artifact) return;

    setIsLoading(true);

    Promise.all([
      window.electron.hydraApi
        .get<ProfileFriends>("/profile/friends", {
          params: { take: FRIENDS_PAGE_SIZE, skip: 0 },
        })
        .then((response) => setFriends(response.friends))
        .catch(() => setFriends([])),
      getShares(),
    ]).finally(() => setIsLoading(false));
  }, [visible, artifact, getShares]);

  const sharedRecipientIds = useMemo(
    () => new Set(shares.map((share) => share.recipientId)),
    [shares]
  );

  // Shares whose recipient is no longer in the friend list still need to be
  // visible so access can be revoked.
  const nonFriendShares = useMemo(() => {
    const friendIds = new Set(friends.map((friend) => friend.id));
    return shares.filter((share) => !friendIds.has(share.recipientId));
  }, [shares, friends]);

  const handleShare = async (friendId: string) => {
    if (!artifact) return;

    setPendingFriendId(friendId);
    try {
      await shareGameArtifact(artifact.id, friendId);
      await getShares();
      showSuccessToast(t("backup_shared"));
    } catch (err) {
      logger.error("Failed to share artifact", err);
      showErrorToast(t("backup_share_failed"));
    } finally {
      setPendingFriendId(null);
    }
  };

  const handleUnshare = async (recipientId: string) => {
    if (!artifact) return;

    setPendingFriendId(recipientId);
    try {
      await unshareGameArtifact(artifact.id, recipientId);
      await getShares();
      showSuccessToast(t("backup_share_revoked"));
    } catch (err) {
      logger.error("Failed to revoke artifact share", err);
      showErrorToast(t("backup_share_revoke_failed"));
    } finally {
      setPendingFriendId(null);
    }
  };

  const renderRow = (
    id: string,
    displayName: string,
    profileImageUrl: string | null,
    isShared: boolean
  ) => (
    <li key={id} className="cloud-sync-share-artifact-modal__row">
      <div className="cloud-sync-share-artifact-modal__row-info">
        <Avatar size={32} src={profileImageUrl} alt={displayName} />
        <span className="cloud-sync-share-artifact-modal__row-name">
          {displayName}
        </span>
      </div>

      {isShared ? (
        <Button
          theme="outline"
          disabled={pendingFriendId === id}
          onClick={() => handleUnshare(id)}
        >
          <XIcon />
          {t("revoke_share")}
        </Button>
      ) : (
        <Button
          theme="outline"
          disabled={pendingFriendId === id}
          onClick={() => handleShare(id)}
        >
          {t("share_with_friend")}
        </Button>
      )}
    </li>
  );

  return (
    <Modal
      visible={visible}
      title={t("share_backup")}
      description={t("share_backup_description")}
      onClose={onClose}
    >
      <div className="cloud-sync-share-artifact-modal__content">
        {isLoading && (
          <p className="cloud-sync-share-artifact-modal__hint">
            {t("loading")}
          </p>
        )}

        {!isLoading && friends.length === 0 && nonFriendShares.length === 0 && (
          <p className="cloud-sync-share-artifact-modal__hint">
            {t("no_friends_to_share")}
          </p>
        )}

        {!isLoading && (friends.length > 0 || nonFriendShares.length > 0) && (
          <ul className="cloud-sync-share-artifact-modal__list">
            {friends.map((friend) =>
              renderRow(
                friend.id,
                friend.displayName,
                friend.profileImageUrl,
                sharedRecipientIds.has(friend.id)
              )
            )}

            {nonFriendShares.map((share) =>
              renderRow(
                share.recipientId,
                share.recipientDisplayName ?? share.recipientId,
                share.recipientProfileImageUrl,
                true
              )
            )}
          </ul>
        )}

        {shares.length > 0 && (
          <p className="cloud-sync-share-artifact-modal__hint">
            <CheckIcon size={14} />
            {t("backup_shared_with_count", { count: shares.length })}
          </p>
        )}
      </div>
    </Modal>
  );
}
