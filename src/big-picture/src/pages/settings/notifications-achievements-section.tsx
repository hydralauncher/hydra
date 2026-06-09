import "./notifications-achievements-section.scss";

import type { AchievementCustomNotificationPosition } from "@types";
import { useEffect, useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  DropdownSelect,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import type { DropdownSelectOption } from "../../components/common/dropdown-select";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import { useBigPictureToast, useUserPreferences } from "../../hooks";
import {
  NOTIFICATIONS_ACHIEVEMENTS_ACTIONS_REGION_ID,
  NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS,
  NOTIFICATIONS_ACHIEVEMENTS_POSITION_SELECT_ID,
  NOTIFICATIONS_ACHIEVEMENTS_SECTION_REGION_ID,
  NOTIFICATIONS_ACHIEVEMENTS_TEST_BUTTON_ID,
  SETTINGS_SIDEBAR_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface NotificationsAchievementsSectionProps {
  className?: string;
  firstItemUpTarget?: FocusOverrideTarget;
}

interface NotificationsAchievementsForm {
  achievementNotificationsEnabled: boolean;
  achievementCustomNotificationsEnabled: boolean;
  achievementCustomNotificationPosition: AchievementCustomNotificationPosition;
}

interface NotificationsAchievementsItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: NotificationsAchievementsForm = {
  achievementNotificationsEnabled: true,
  achievementCustomNotificationsEnabled: true,
  achievementCustomNotificationPosition: "top-left",
};
const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

function getPositionLabel(position: AchievementCustomNotificationPosition) {
  return position
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function NotificationsAchievementsSection({
  className,
  firstItemUpTarget,
}: Readonly<NotificationsAchievementsSectionProps>) {
  const userPreferences = useUserPreferences();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [form, setForm] = useState<NotificationsAchievementsForm>(DEFAULT_FORM);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      achievementNotificationsEnabled:
        userPreferences.achievementNotificationsEnabled ?? true,
      achievementCustomNotificationsEnabled:
        userPreferences.achievementCustomNotificationsEnabled ?? true,
      achievementCustomNotificationPosition:
        userPreferences.achievementCustomNotificationPosition ?? "top-left",
    });
  }, [userPreferences]);

  const updateUserPreferences = async (
    values: Partial<NotificationsAchievementsForm>
  ) => {
    const nextForm = { ...form, ...values };
    setForm(nextForm);

    await globalThis.window.electron.updateUserPreferences(values);
  };

  const items = useMemo<NotificationsAchievementsItem[]>(() => {
    return [
      {
        id: "achievement-notifications-enabled",
        focusId:
          NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS.achievementNotificationsEnabled,
        label: "Enable achievement notifications",
        checked: form.achievementNotificationsEnabled,
        disabled: false,
        onChange: (checked: boolean) => {
          void (async () => {
            await updateUserPreferences({
              achievementNotificationsEnabled: checked,
            });
            await globalThis.window.electron.updateAchievementCustomNotificationWindow();
          })();
        },
      },
      {
        id: "achievement-custom-notifications-enabled",
        focusId:
          NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS.achievementCustomNotificationsEnabled,
        label: "Enable custom achievement notifications",
        checked: form.achievementCustomNotificationsEnabled,
        disabled: !form.achievementNotificationsEnabled,
        onChange: (checked: boolean) => {
          void (async () => {
            await updateUserPreferences({
              achievementCustomNotificationsEnabled: checked,
            });
            await globalThis.window.electron.updateAchievementCustomNotificationWindow();
          })();
        },
      },
    ];
  }, [form]);

  const focusableItems = useMemo(
    () => items.filter((item) => !item.disabled),
    [items]
  );

  const showActionsRow =
    form.achievementNotificationsEnabled &&
    form.achievementCustomNotificationsEnabled;

  const positionOptions = useMemo<
    Array<DropdownSelectOption<AchievementCustomNotificationPosition>>
  >(() => {
    return (
      [
        "top-left",
        "top-center",
        "top-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ] as AchievementCustomNotificationPosition[]
    ).map((position) => ({
      value: position,
      label: getPositionLabel(position),
    }));
  }, []);

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const previousFallback =
      firstItemUpTarget ?? ({ type: "block" } satisfies FocusOverrideTarget);

    return Object.fromEntries(
      focusableItems.map((item, index) => {
        const previousItem = focusableItems[index - 1];
        const nextItem = focusableItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : previousFallback,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : showActionsRow
                ? {
                    type: "item",
                    itemId: NOTIFICATIONS_ACHIEVEMENTS_POSITION_SELECT_ID,
                  }
                : {
                    type: "block",
                  },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [firstItemUpTarget, focusableItems, showActionsRow]);

  const lastFocusableAchievementItemId =
    focusableItems[focusableItems.length - 1]?.focusId ??
    NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS.achievementNotificationsEnabled;

  const actionsNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: lastFocusableAchievementItemId,
      },
      down: {
        type: "block",
      },
    }),
    [lastFocusableAchievementItemId]
  );

  return (
    <SettingsSection
      title="Achievements"
      description="Control achievement popups and custom notification behavior."
      className={className}
    >
      <VerticalFocusGroup
        regionId={NOTIFICATIONS_ACHIEVEMENTS_SECTION_REGION_ID}
        asChild
      >
        <div className="notifications-achievements-section__content">
          {items.map((item) => (
            <Checkbox
              key={item.id}
              id={item.id}
              label={item.label}
              checked={item.checked}
              disabled={item.disabled}
              focusId={item.focusId}
              navigationOverrides={
                item.disabled
                  ? undefined
                  : navigationOverridesByFocusId[item.focusId]
              }
              block
              onChange={item.onChange}
            />
          ))}

          {showActionsRow ? (
            <HorizontalFocusGroup
              regionId={NOTIFICATIONS_ACHIEVEMENTS_ACTIONS_REGION_ID}
              navigationOverrides={actionsNavigationOverrides}
              asChild
            >
              <div className="notifications-achievements-section__actions">
                <div className="notifications-achievements-section__actions-item">
                  <DropdownSelect
                    className="notifications-achievements-section__select"
                    label="Achievement notification position"
                    value={form.achievementCustomNotificationPosition}
                    options={positionOptions}
                    focusId={NOTIFICATIONS_ACHIEVEMENTS_POSITION_SELECT_ID}
                    focusNavigationOverrides={{
                      ...actionsNavigationOverrides,
                      left: SETTINGS_SIDEBAR_RETURN_TARGET,
                      right: {
                        type: "item",
                        itemId: NOTIFICATIONS_ACHIEVEMENTS_TEST_BUTTON_ID,
                      },
                    }}
                    onValueChange={(value) => {
                      void (async () => {
                        await updateUserPreferences({
                          achievementCustomNotificationPosition: value,
                        });
                        await globalThis.window.electron.updateAchievementCustomNotificationWindow();
                      })();
                    }}
                  />
                </div>

                <div className="notifications-achievements-section__actions-item">
                  <Button
                    className="notifications-achievements-section__test-button"
                    variant="secondary"
                    size="medium"
                    focusId={NOTIFICATIONS_ACHIEVEMENTS_TEST_BUTTON_ID}
                    focusNavigationOverrides={{
                      ...actionsNavigationOverrides,
                      left: {
                        type: "item",
                        itemId: NOTIFICATIONS_ACHIEVEMENTS_POSITION_SELECT_ID,
                      },
                      right: {
                        type: "block",
                      },
                    }}
                    onClick={() => {
                      void globalThis.window.electron
                        .showAchievementTestNotification()
                        .then(() => {
                          showSuccessToast("Achievement unlocked");
                        })
                        .catch(() => {
                          showErrorToast("Notification failed", {
                            ...SETTINGS_TOAST_OPTIONS,
                            message:
                              "Hydra could not show the achievement preview.",
                          });
                        });
                    }}
                  >
                    Test Notification
                  </Button>
                </div>
              </div>
            </HorizontalFocusGroup>
          ) : null}
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
