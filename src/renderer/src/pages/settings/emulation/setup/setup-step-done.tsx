import { useTranslation } from "react-i18next";
import { CheckIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";

interface Props {
  systemLabel: string;
  gamesAdded: number;
  onBrowse: () => void;
  onManage: () => void;
}

export function SetupStepDone({
  systemLabel,
  gamesAdded,
  onBrowse,
  onManage,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");

  return (
    <div className="setup-modal__done">
      <div className="setup-modal__done-check">
        <CheckIcon size={28} />
      </div>
      <h3 className="setup-modal__done-title">
        {t("setup_done_title", { system: systemLabel })}
      </h3>
      <p className="setup-modal__done-body">
        {t(gamesAdded === 1 ? "setup_done_body_one" : "setup_done_body_other", {
          count: gamesAdded,
        })}
      </p>
      <div className="setup-modal__done-actions">
        <Button theme="primary" onClick={onBrowse}>
          {t("setup_done_browse")}
        </Button>
        <Button theme="outline" onClick={onManage}>
          {t("setup_done_manage")}
        </Button>
      </div>
    </div>
  );
}
