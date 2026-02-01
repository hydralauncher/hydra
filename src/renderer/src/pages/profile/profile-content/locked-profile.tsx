import { Lock } from "iconsax-reactjs";
import { useTranslation } from "react-i18next";
import "./locked-profile.scss";

export function LockedProfile() {
  const { t } = useTranslation("user_profile");

  return (
    <div className="locked-profile__container">
      <div className="locked-profile__lock-icon">
        <Lock size={24} variant="Outline" />
      </div>

      <h2>{t("locked_profile")}</h2>
    </div>
  );
}
