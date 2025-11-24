import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ProtonDBBadgeProps {
  appId: number | undefined;
}

export function ProtonDBBadge({ appId }: Readonly<ProtonDBBadgeProps>) {
  const { t } = useTranslation("game_details");
  const [tier, setTier] = useState<string | null>(null);

  useEffect(() => {
    if (appId) {
      window.electron.getProtonDBTier(appId).then(setTier);
    }
  }, [appId]);

  if (!tier) {
    return null;
  }

  return (
    <a
      href={`https://www.protondb.com/app/${appId}`}
      target="_blank"
      rel="noreferrer"
      className={`protondb-badge protondb-badge--${tier}`}
    >
      {t("protondb_tier", { tier })}
    </a>
  );
}
