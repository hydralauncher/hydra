import { useState } from "react";
import { Button } from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";
import { useAppDispatch } from "@renderer/hooks";
import { setUserPreferences } from "@renderer/features";

export function Settings() {
  const { t } = useTranslation("settings");

  const dispatch = useAppDispatch();

  const categories = [
    {name: t("general"), component: SettingsGeneral},
    {name: t("behavior"), component: SettingsBehavior}, 
    {name: "Real-Debrid", component: SettingsRealDebrid}
  ];

  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);

  const handleUpdateUserPreferences = async (
    values: Partial<UserPreferences>
  ) => {
    await window.electron.updateUserPreferences(values);
    window.electron.getUserPreferences().then((userPreferences) => {
      dispatch(setUserPreferences(userPreferences));
    });
  };

  const renderCategory = () => {
    const CategoryComponent = categories[currentCategoryIndex].component;
    return (
      <CategoryComponent updateUserPreferences={handleUpdateUserPreferences} />
    );
  };

  return (
    <section className={styles.container}>
      <div className={styles.content}>
        <section className={styles.settingsCategories}>
          {categories.map((category, index) => (
            <Button
              key={category.name}
              theme={currentCategoryIndex === index ? "primary" : "outline"}
              onClick={() => setCurrentCategoryIndex(index)}
            >
              {category.name}
            </Button>
          ))}
        </section>

        <h2>{categories[currentCategoryIndex].name}</h2>
        {renderCategory()}
      </div>
    </section>
  );
}
