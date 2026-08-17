import { Button } from "@renderer/components";
import { useTranslation } from "react-i18next";
import "./profile-content.scss";

export type ProfileTabType =
  | "library"
  | "reviews"
  | "stats"
  | "friends"
  | "activity";

interface ProfileTabsProps {
  activeTab: ProfileTabType;
  reviewsTotalCount: number;
  onTabChange: (tab: ProfileTabType) => void;
  showFriendsTab?: boolean;
  showActivityTab?: boolean;
  isBgLight?: boolean;
}

export function ProfileTabs({
  activeTab,
  reviewsTotalCount,
  onTabChange,
  showFriendsTab,
  showActivityTab,
  isBgLight = false,
}: Readonly<ProfileTabsProps>) {
  const { t } = useTranslation("user_profile");

  return (
    <ul className="profile-content__home-style-tabs">
      <li>
        <Button
          theme={
            activeTab === "library"
              ? isBgLight
                ? "dark"
                : "primary"
              : "outline"
          }
          onClick={() => onTabChange("library")}
        >
          {t("library", { defaultValue: "Biblioteca" })}
        </Button>
      </li>
      <li>
        <Button
          theme={
            activeTab === "reviews"
              ? isBgLight
                ? "dark"
                : "primary"
              : "outline"
          }
          onClick={() => onTabChange("reviews")}
        >
          {t("user_reviews", { defaultValue: "Avaliações" })}
          {reviewsTotalCount > 0 && ` (${reviewsTotalCount})`}
        </Button>
      </li>
      <li>
        <Button
          theme={
            activeTab === "stats" ? (isBgLight ? "dark" : "primary") : "outline"
          }
          onClick={() => onTabChange("stats")}
        >
          {t("stats", { defaultValue: "Estatísticas" })}
        </Button>
      </li>
      {showFriendsTab && (
        <li>
          <Button
            theme={
              activeTab === "friends"
                ? isBgLight
                  ? "dark"
                  : "primary"
                : "outline"
            }
            onClick={() => onTabChange("friends")}
          >
            {t("friends", { defaultValue: "Amigos" })}
          </Button>
        </li>
      )}
      {showActivityTab && (
        <li>
          <Button
            theme={
              activeTab === "activity"
                ? isBgLight
                  ? "dark"
                  : "primary"
                : "outline"
            }
            onClick={() => onTabChange("activity")}
          >
            {t("activity", { defaultValue: "Atividade" })}
          </Button>
        </li>
      )}
    </ul>
  );
}
