import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import "./profile-content.scss";

interface ProfileTabsProps {
  activeTab: "library" | "reviews" | "souvenirs";
  reviewsTotalCount: number;
  souvenirsCount: number;
  onTabChange: (tab: "library" | "reviews" | "souvenirs") => void;
}

export function ProfileTabs({
  activeTab,
  reviewsTotalCount,
  souvenirsCount,
  onTabChange,
}: Readonly<ProfileTabsProps>) {
  const { t } = useTranslation("user_profile");

  return (
    <div className="profile-content__tabs">
      <div className="profile-content__tab-wrapper">
        <button
          type="button"
          className={`profile-content__tab ${activeTab === "library" ? "profile-content__tab--active" : ""}`}
          onClick={() => onTabChange("library")}
        >
          {t("library")}
        </button>
        {activeTab === "library" && (
          <motion.div
            className="profile-content__tab-underline"
            layoutId="tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
      <div className="profile-content__tab-wrapper">
        <button
          type="button"
          className={`profile-content__tab ${activeTab === "reviews" ? "profile-content__tab--active" : ""}`}
          onClick={() => onTabChange("reviews")}
        >
          {t("user_reviews")}
          {reviewsTotalCount > 0 && (
            <span className="profile-content__tab-badge">
              {reviewsTotalCount}
            </span>
          )}
        </button>
        {activeTab === "reviews" && (
          <motion.div
            className="profile-content__tab-underline"
            layoutId="tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
      <div className="profile-content__tab-wrapper">
        <button
          type="button"
          className={`profile-content__tab ${activeTab === "souvenirs" ? "profile-content__tab--active" : ""}`}
          onClick={() => onTabChange("souvenirs")}
        >
          {t("souvenirs")}
          {souvenirsCount > 0 && (
            <span className="profile-content__tab-badge">{souvenirsCount}</span>
          )}
        </button>
        {activeTab === "souvenirs" && (
          <motion.div
            className="profile-content__tab-underline"
            layoutId="tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
    </div>
  );
}
