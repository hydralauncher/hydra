import { LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import "./locked-profile.scss";

export function LockedProfile() {
  const { t } = useTranslation("user_profile");

  return (
    <div className="locked-profile__container">
      <div className="locked-profile__lock-icon">
        <LockIcon size={24} />
      </div>

      <h2>{t("locked_profile")}</h2>
    </div>
  );
}
