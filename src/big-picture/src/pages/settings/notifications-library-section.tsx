import "./notifications-library-section.scss";

import { useEffect, useMemo, useState } from "react";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS,
  NOTIFICATIONS_LIBRARY_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface NotificationsLibrarySectionProps {
  className?: string;
  lastItemDownTarget?: FocusOverrideTarget;
}

interface NotificationsLibraryForm {
  downloadNotificationsEnabled: boolean;
  repackUpdatesNotificationsEnabled: boolean;
  friendRequestNotificationsEnabled: boolean;
  friendStartGameNotificationsEnabled: boolean;
}

interface NotificationsLibraryItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: NotificationsLibraryForm = {
  downloadNotificationsEnabled: false,
  repackUpdatesNotificationsEnabled: false,
  friendRequestNotificationsEnabled: false,
  friendStartGameNotificationsEnabled: true,
};

export function NotificationsLibrarySection({
  className,
  lastItemDownTarget,
}: Readonly<NotificationsLibrarySectionProps>) {
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<NotificationsLibraryForm>(DEFAULT_FORM);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      downloadNotificationsEnabled:
        userPreferences.downloadNotificationsEnabled ?? false,
      repackUpdatesNotificationsEnabled:
        userPreferences.repackUpdatesNotificationsEnabled ?? false,
      friendRequestNotificationsEnabled:
        userPreferences.friendRequestNotificationsEnabled ?? false,
      friendStartGameNotificationsEnabled:
        userPreferences.friendStartGameNotificationsEnabled ?? true,
    });
  }, [userPreferences]);

  const updateUserPreferences = async (
    values: Partial<NotificationsLibraryForm>
  ) => {
    const nextForm = { ...form, ...values };
    setForm(nextForm);

    await globalThis.window.electron.updateUserPreferences(values);
  };

  const items = useMemo<NotificationsLibraryItem[]>(() => {
    return [
      {
        id: "download-notifications-enabled",
        focusId:
          NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.downloadNotificationsEnabled,
        label: "Enable download notifications",
        checked: form.downloadNotificationsEnabled,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ downloadNotificationsEnabled: checked }),
      },
      {
        id: "repack-updates-notifications-enabled",
        focusId:
          NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.repackUpdatesNotificationsEnabled,
        label: "Enable repack update notifications",
        checked: form.repackUpdatesNotificationsEnabled,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            repackUpdatesNotificationsEnabled: checked,
          }),
      },
      {
        id: "friend-request-notifications-enabled",
        focusId:
          NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.friendRequestNotificationsEnabled,
        label: "Enable friend request notifications",
        checked: form.friendRequestNotificationsEnabled,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            friendRequestNotificationsEnabled: checked,
          }),
      },
      {
        id: "friend-start-game-notifications-enabled",
        focusId:
          NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.friendStartGameNotificationsEnabled,
        label: "Enable friend start game notifications",
        checked: form.friendStartGameNotificationsEnabled,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            friendStartGameNotificationsEnabled: checked,
          }),
      },
    ];
  }, [form]);

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      items.map((item, index) => {
        const previousItem = items[index - 1];
        const nextItem = items[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : lastItemDownTarget,
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [items, lastItemDownTarget]);

  return (
    <SettingsSection
      title="Library"
      description="Choose which library activity notifications Hydra should show."
      className={className}
    >
      <VerticalFocusGroup
        regionId={NOTIFICATIONS_LIBRARY_SECTION_REGION_ID}
        asChild
      >
        <div className="notifications-library-section__content">
          {items.map((item) => (
            <Checkbox
              key={item.id}
              id={item.id}
              label={item.label}
              checked={item.checked}
              focusId={item.focusId}
              navigationOverrides={navigationOverridesByFocusId[item.focusId]}
              block
              onChange={item.onChange}
            />
          ))}
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
