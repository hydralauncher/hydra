import { useCallback, useEffect, useState } from "react";
import { Button } from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";
import { Toast } from "@renderer/components/toast/toast";

const categories = ["general", "behavior", "real_debrid"];

export function Settings() {
  const [currentCategory, setCurrentCategory] = useState(categories.at(0)!);
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);
  const [isToastVisible, setIsToastVisible] = useState(false);

  const { t } = useTranslation("settings");

  useEffect(() => {
    window.electron.getUserPreferences().then((userPreferences) => {
      setUserPreferences(userPreferences);
    });
  }, []);

  const handleUpdateUserPreferences = async (
    values: Partial<UserPreferences>
  ) => {
    await window.electron.updateUserPreferences(values);
    window.electron.getUserPreferences().then((userPreferences) => {
      setUserPreferences(userPreferences);
      setIsToastVisible(true);
    });
  };

  const renderCategory = () => {
    if (currentCategory === "general") {
      return (
        <SettingsGeneral
          userPreferences={userPreferences}
          updateUserPreferences={handleUpdateUserPreferences}
        />
      );
    }

    if (currentCategory === "real_debrid") {
      return (
        <SettingsRealDebrid
          userPreferences={userPreferences}
          updateUserPreferences={handleUpdateUserPreferences}
        />
      );
    }

    return (
      <SettingsBehavior
        userPreferences={userPreferences}
        updateUserPreferences={handleUpdateUserPreferences}
      />
    );
  };

  const handleToastClose = useCallback(() => {
    setIsToastVisible(false);
  }, []);

  return (
    <>
      <section className={styles.container}>
        <div className={styles.content}>
          <section className={styles.settingsCategories}>
            {categories.map((category) => (
              <Button
                key={category}
                theme={currentCategory === category ? "primary" : "outline"}
                onClick={() => setCurrentCategory(category)}
              >
                {t(category)}
              </Button>
            ))}
          </section>

          <h2>{t(currentCategory)}</h2>
          {renderCategory()}
        </div>
      </section>

      <Toast
        message="Settings have been saved"
        visible={isToastVisible}
        onClose={handleToastClose}
        type="success"
      />
    </>
  );
}
