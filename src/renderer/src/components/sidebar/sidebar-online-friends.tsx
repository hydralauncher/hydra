import { useEffect, useState } from "react";
import { useUserDetails } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { PersonIcon } from "@primer/octicons-react";

interface OnlineFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  currentGame: { title: string } | null;
}

export function SidebarOnlineFriends() {
  const { userDetails } = useUserDetails();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<OnlineFriend[]>([]);

  useEffect(() => {
    if (!userDetails?.id) {
      setFriends([]);
      return;
    }

    window.electron.hydraApi
      .get<{ friends?: OnlineFriend[] }>("/profile/friends", {
        params: { take: 100, skip: 0 },
      })
      .then((data) => {
        const online = (data?.friends ?? []).filter((f) => f.currentGame);
        setFriends(online.slice(0, 5));
      })
      .catch(() => {});
  }, [userDetails?.id]);

  if (!userDetails || friends.length === 0) return null;

  return (
    <div className="sidebar-online-friends">
      <p className="sidebar-online-friends__label">Online agora</p>
      <ul className="sidebar-online-friends__list">
        {friends.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="sidebar-online-friends__item"
              onClick={() => navigate(`/profile/${f.id}`)}
            >
              <div className="sidebar-online-friends__avatar">
                {f.profileImageUrl ? (
                  <img src={f.profileImageUrl} alt={f.displayName} />
                ) : (
                  <PersonIcon size={12} />
                )}
                <span className="sidebar-online-friends__dot" />
              </div>
              <div className="sidebar-online-friends__info">
                <span className="sidebar-online-friends__name">
                  {f.displayName}
                </span>
                {f.currentGame && (
                  <span className="sidebar-online-friends__game">
                    {f.currentGame.title}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
