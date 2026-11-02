import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import "./profile-content.scss";

export type ProfileTabType =
  | "library"
  | "reviews"
  | "souvenirs"
  | "screenshots"
  | "missions";

const TAB_INDICATOR_SPRING = {
  type: "spring",
  stiffness: 300,
  damping: 30,
} as const;

interface ProfileTabsProps {
  activeTab: ProfileTabType;
  reviewsTotalCount: number;
  souvenirsCount: number;
  screenshotsCount: number;
  showScreenshots: boolean;
  showMissions: boolean;
  onTabChange: (tab: ProfileTabType) => void;
}

interface ProfileTabDefinition {
  id: ProfileTabType;
  label: string;
  count: number;
}

export function ProfileTabs({
  activeTab,
  reviewsTotalCount,
  souvenirsCount,
  screenshotsCount,
  showScreenshots,
  showMissions,
  onTabChange,
}: Readonly<ProfileTabsProps>) {
  const { t } = useTranslation(["user_profile", "screenshots"]);

  const tabs: ProfileTabDefinition[] = [
    { id: "library", label: t("library"), count: 0 },
    { id: "reviews", label: t("user_reviews"), count: reviewsTotalCount },
    { id: "souvenirs", label: t("souvenirs"), count: souvenirsCount },
  ];

  if (showScreenshots) {
    tabs.push({
      id: "screenshots",
      label: t("tab_title", { ns: "screenshots" }),
      count: screenshotsCount,
    });
  }

  if (showMissions) {
    tabs.push({ id: "missions", label: t("missions_tab"), count: 0 });
  }

  return (
    <div className="profile-content__tabs">
      {tabs.map((tab) => (
        <div key={tab.id} className="profile-content__tab-wrapper">
          <button
            type="button"
            className={`profile-content__tab ${activeTab === tab.id ? "profile-content__tab--active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="profile-content__tab-badge">{tab.count}</span>
            )}
          </button>
          {activeTab === tab.id && (
            <motion.div
              className="profile-content__tab-underline"
              layoutId="tab-underline"
              transition={TAB_INDICATOR_SPRING}
            />
          )}
        </div>
      ))}
    </div>
  );
}
