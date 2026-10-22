import { useTranslation } from "react-i18next";
import type { PassiveProgress, PassiveType } from "@types";

const PASSIVE_RULE_KEYS: Partial<Record<PassiveType, string>> = {
  session: "passive_session_rule",
  review: "passive_review_rule",
  friend: "passive_friend_rule",
};

export function PassivesBox({
  passives,
}: Readonly<{ passives: PassiveProgress[] }>) {
  const { t } = useTranslation("user_profile");

  return (
    <div className="passives-box">
      <ul>
        {passives.map((passive) => {
          const ruleKey = PASSIVE_RULE_KEYS[passive.type];
          const today = t("passive_today", {
            today: passive.today,
            limit: passive.dailyLimit,
          });

          return (
            <li key={passive.type} className="passives-box__row">
              <div>
                <span>{t(`passive_${passive.type}`)}</span>
                <small>{ruleKey ? `${t(ruleKey)} · ${today}` : today}</small>
              </div>
              <span className="passives-box__xp">+{passive.xp} XP</span>
            </li>
          );
        })}
      </ul>
      <p className="passives-box__hint">{t("passives_hint")}</p>
    </div>
  );
}
