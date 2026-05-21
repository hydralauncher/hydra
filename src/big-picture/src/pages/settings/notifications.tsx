import "./notifications.scss";

import { NotificationsAchievementsSection } from "./notifications-achievements-section";
import { NotificationsLibrarySection } from "./notifications-library-section";
import {
  NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS,
  NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS,
} from "./settings-navigation";

interface SettingsSectionProps {
  className?: string;
}

export function NotificationsSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  return (
    <div
      className={
        className
          ? `notifications-settings-section ${className}`
          : "notifications-settings-section"
      }
    >
      <NotificationsLibrarySection
        lastItemDownTarget={{
          type: "item",
          itemId:
            NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS.achievementNotificationsEnabled,
        }}
      />

      <NotificationsAchievementsSection
        firstItemUpTarget={{
          type: "item",
          itemId:
            NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.friendStartGameNotificationsEnabled,
        }}
      />
    </div>
  );
}
