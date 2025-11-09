import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { SearchIcon } from "@primer/octicons-react";
import "./profile-content.scss";

interface Achievement {
  name: string;
  imageUrl: string;
  achievementIcon: string | null;
  gameTitle: string;
  gameIconUrl: string | null;
}

interface SouvenirsTabProps {
  achievements: Achievement[];
  onImageClick: (imageUrl: string, achievementName: string) => void;
}

export function SouvenirsTab({
  achievements,
  onImageClick,
}: Readonly<SouvenirsTabProps>) {
  const { t } = useTranslation("user_profile");

  return (
    <motion.div
      key="souvenirs"
      className="profile-content__tab-panel"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
      aria-hidden={false}
    >
      {achievements.length === 0 && (
        <div className="profile-content__no-souvenirs">
          <p>{t("no_souvenirs", "No souvenirs yet")}</p>
        </div>
      )}
      {achievements.length > 0 && (
        <div className="profile-content__images-grid">
          {achievements.map((achievement, index) => (
            <div
              key={`${achievement.gameTitle}-${achievement.name}-${index}`}
              className="profile-content__image-card"
            >
              <div className="profile-content__image-card-header">
                <div className="profile-content__image-achievement-image-wrapper">
                  <button
                    type="button"
                    className="profile-content__image-button"
                    onClick={() =>
                      onImageClick(achievement.imageUrl, achievement.name)
                    }
                    aria-label={`View ${achievement.name} screenshot in fullscreen`}
                    style={{
                      cursor: "pointer",
                      padding: 0,
                      border: "none",
                      background: "transparent",
                    }}
                  >
                    <img
                      src={achievement.imageUrl}
                      alt={achievement.name}
                      className="profile-content__image-achievement-image"
                      loading="lazy"
                    />
                  </button>
                  <div className="profile-content__image-achievement-image-overlay">
                    <SearchIcon size={20} />
                  </div>
                </div>
              </div>

              <div className="profile-content__image-card-content">
                <div className="profile-content__image-achievement-info">
                  {achievement.achievementIcon && (
                    <img
                      src={achievement.achievementIcon}
                      alt=""
                      className="profile-content__image-achievement-icon"
                      loading="lazy"
                    />
                  )}
                  <span className="profile-content__image-achievement-name">
                    {achievement.name}
                  </span>
                </div>

                <div className="profile-content__image-game-info">
                  <div className="profile-content__image-game-left">
                    {achievement.gameIconUrl && (
                      <img
                        src={achievement.gameIconUrl}
                        alt=""
                        className="profile-content__image-game-icon"
                        loading="lazy"
                      />
                    )}
                    <span className="profile-content__image-game-title">
                      {achievement.gameTitle}
                    </span>
                  </div>
                </div>
              </div>

              <div className="profile-content__image-card-gradient-overlay"></div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
