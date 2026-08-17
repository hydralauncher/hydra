import { userProfileContext } from "@renderer/context";
import { useContext, useState } from "react";
import { AllBadgesModal } from "./all-badges-modal";
import "./badges-box.scss";

export function BadgesBox() {
  const { userProfile, badges } = useContext(userProfileContext);
  const [showAllBadgesModal, setShowAllBadgesModal] = useState(false);

  if (!userProfile || !userProfile.badges || userProfile.badges.length === 0)
    return null;

  return (
    <>
      <div className="badges-box__small-list">
        {userProfile.badges.map((badgeName) => {
          const badge = badges.find((b) => b.name === badgeName);

          if (!badge) return null;

          return (
            <button
              key={badge.name}
              type="button"
              className="badges-box__small-item"
              onClick={() => setShowAllBadgesModal(true)}
              title={badge.title}
            >
              <img
                src={badge.badge.url}
                alt={badge.name}
                width={18}
                height={18}
              />
            </button>
          );
        })}
      </div>

      <AllBadgesModal
        visible={showAllBadgesModal}
        onClose={() => setShowAllBadgesModal(false)}
      />
    </>
  );
}
