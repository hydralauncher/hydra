import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  GameShop,
  Ps4PkgAccept,
  Ps4PkgFailure,
  Ps4PkgJobEvent,
} from "@types";
import { Button } from "../button/button";
import { Modal } from "../modal/modal";
import { InstallProgressBar } from "../setup-modal/install-progress-bar";
import { useToast } from "@renderer/hooks";

import "@renderer/components/setup-modal/setup-modal.scss";
import "./ps4-pkg-job-modal.scss";

export const ps4PkgErrorKey = (reason?: Ps4PkgFailure) => {
  switch (reason) {
    case "not_update":
      return "ps4_update_not_update";
    case "unsupported":
      return "ps4_pkg_unsupported";
    case "no_game_folder":
      return "ps4_update_no_game_folder";
    case "other_game":
      return "ps4_update_other_game";
    case "not_newer":
      return "ps4_update_not_newer";
    case "no_space":
      return "ps4_update_no_space";
    case "busy":
      return "ps4_pkg_busy";
    default:
      return "ps4_pkg_failed";
  }
};

/**
 * Shows every PS4 PKG job the main process runs (applying an update,
 * extracting a game), wherever it was started from. Mounted once in the app.
 */
export function Ps4PkgJobModal() {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const [job, setJob] = useState<Ps4PkgJobEvent | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(
    () =>
      window.electron.onPs4PkgJob((event) => {
        if (event.phase === "start") {
          setCancelling(false);
          setJob(event);
          return;
        }
        if (event.phase === "progress") {
          setJob((current) =>
            current ? { ...current, progress: event.progress } : event
          );
          return;
        }

        setJob(null);
        if (event.phase === "done" && event.mode === "update") {
          showSuccessToast(
            t("ps4_update_done", { version: event.version ?? "" })
          );
        } else if (event.phase === "error") {
          showErrorToast(t(ps4PkgErrorKey(event.reason)));
        }
      }),
    [showSuccessToast, showErrorToast, t]
  );

  const cancel = () => {
    setCancelling(true);
    void window.electron.cancelPs4PkgJob();
  };

  const percent = Math.round((job?.progress ?? 0) * 100);
  const isUpdate = job?.mode === "update";
  let status = job?.title ?? "";
  if (isUpdate) {
    status =
      job?.currentVersion && job.version
        ? t("ps4_update_versions", {
            from: job.currentVersion,
            to: job.version,
          })
        : t("ps4_update_applying");
  }

  return (
    <Modal
      visible={job !== null}
      title={isUpdate ? t("apply_ps4_update") : t("ps4_pkg_extracting")}
      onClose={cancel}
      clickOutsideToClose={false}
    >
      <div className="ps4-pkg-job-modal">
        <div className="ps4-pkg-job-modal__status">
          <span>{status}</span>
          <span>{percent}%</span>
        </div>

        <InstallProgressBar
          progress={{ phase: "downloading", loaded: percent, total: 100 }}
        />

        <div className="ps4-pkg-job-modal__actions">
          <Button theme="outline" onClick={cancel} disabled={cancelling}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Picks a PS4 PKG and starts the matching job: an update over the game
 * folder, or (with "any") extracting a game PKG into a new disc.
 */
export function usePs4PkgPicker(
  shop: GameShop,
  objectId: string,
  accept: Ps4PkgAccept,
  onFinish?: () => void
) {
  const { t } = useTranslation("game_details");
  const { showErrorToast } = useToast();
  const [isBusy, setIsBusy] = useState(false);

  const pick = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "PKG", extensions: ["pkg"] }],
    });
    const pkgPath = filePaths?.[0];
    if (canceled || !pkgPath) {
      onFinish?.();
      return;
    }

    setIsBusy(true);
    try {
      const check = await window.electron
        .checkPs4Pkg(shop, objectId, pkgPath, accept)
        .catch(() => null);
      if (!check?.ok) {
        showErrorToast(
          t(ps4PkgErrorKey(check?.ok === false ? check.reason : undefined))
        );
        return;
      }

      const result =
        check.mode === "update"
          ? await window.electron.applyPs4Update(shop, objectId, pkgPath)
          : await window.electron.extractPs4GamePkg(shop, objectId, pkgPath);
      if (result.reason === "busy") showErrorToast(t("ps4_pkg_busy"));
    } finally {
      setIsBusy(false);
      onFinish?.();
    }
  };

  return { pick, isBusy };
}
