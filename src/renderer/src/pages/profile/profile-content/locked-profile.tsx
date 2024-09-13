import { LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import * as styles from "./locked-profile.css";

export function LockedProfile() {
  const { t } = useTranslation("user_profile");

  return (
    <div className={styles.container}>
      <div className={styles.lockIcon}>
        <LockIcon size={24} />
      </div>
      <h2>{t("locked_profile")}</h2>
      <p>{t("locked_profile_description")}</p>
    </div>
  );
}
