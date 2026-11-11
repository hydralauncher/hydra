import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GameShop, Ps4UpdateFailure } from "@types";
import { Button } from "../button/button";
import { Modal } from "../modal/modal";
import { InstallProgressBar } from "../setup-modal/install-progress-bar";
import { useToast } from "@renderer/hooks";

import "@renderer/components/setup-modal/setup-modal.scss";
import "./ps4-update-modal.scss";

export interface Ps4UpdateRequest {
  pkgPath: string;
  version: string | null;
  currentVersion: string | null;
}

interface Ps4UpdateModalProps {
  shop: GameShop;
  objectId: string;
  request: Ps4UpdateRequest | null;
  onClose: () => void;
}

export const ps4UpdateErrorKey = (reason?: Ps4UpdateFailure) => {
  switch (reason) {
    case "not_update":
      return "ps4_update_not_update";
    case "no_game_folder":
      return "ps4_update_no_game_folder";
    case "other_game":
      return "ps4_update_other_game";
    case "not_newer":
      return "ps4_update_not_newer";
    case "no_space":
      return "ps4_update_no_space";
    default:
      return "ps4_update_failed";
  }
};

export function Ps4UpdateModal({
  shop,
  objectId,
  request,
  onClose,
}: Readonly<Ps4UpdateModalProps>) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!request || startedFor.current === request.pkgPath) return;
    startedFor.current = request.pkgPath;
    setProgress(0);
    setCancelling(false);

    const unsubscribe = window.electron.onPs4UpdateProgress((payload) => {
      if (payload.objectId === objectId) setProgress(payload.progress);
    });

    void window.electron
      .applyPs4Update(shop, objectId, request.pkgPath)
      .then((result) => {
        if (result.ok) {
          showSuccessToast(
            t("ps4_update_done", { version: result.version ?? "" })
          );
        } else if (result.reason !== "cancelled") {
          showErrorToast(t(ps4UpdateErrorKey(result.reason)));
        }
      })
      .catch(() => showErrorToast(t("ps4_update_failed")))
      .finally(() => {
        unsubscribe();
        startedFor.current = null;
        onClose();
      });
  }, [request, shop, objectId, onClose, showSuccessToast, showErrorToast, t]);

  const cancel = () => {
    setCancelling(true);
    void window.electron.cancelPs4Update();
  };

  const percent = Math.round(progress * 100);

  return (
    <Modal
      visible={request !== null}
      title={t("apply_ps4_update")}
      onClose={cancel}
      clickOutsideToClose={false}
    >
      <div className="ps4-update-modal">
        <div className="ps4-update-modal__status">
          <span>
            {request?.currentVersion && request.version
              ? t("ps4_update_versions", {
                  from: request.currentVersion,
                  to: request.version,
                })
              : t("ps4_update_applying")}
          </span>
          <span>{percent}%</span>
        </div>

        <InstallProgressBar
          progress={{ phase: "downloading", loaded: percent, total: 100 }}
        />

        <div className="ps4-update-modal__actions">
          <Button theme="outline" onClick={cancel} disabled={cancelling}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Picks an update PKG, checks it and opens the progress modal. Render
 * `modal` somewhere that stays mounted while the update runs.
 */
export function usePs4UpdatePicker(
  shop: GameShop,
  objectId: string,
  onFinish?: () => void
) {
  const { t } = useTranslation("game_details");
  const { showErrorToast } = useToast();
  const [request, setRequest] = useState<Ps4UpdateRequest | null>(null);

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

    const check = await window.electron
      .checkPs4Update(shop, objectId, pkgPath)
      .catch(() => null);
    if (!check?.ok) {
      showErrorToast(
        t(ps4UpdateErrorKey(check?.ok === false ? check.reason : undefined))
      );
      onFinish?.();
      return;
    }

    setRequest({
      pkgPath,
      version: check.version,
      currentVersion: check.currentVersion,
    });
  };

  const close = useCallback(() => {
    setRequest(null);
    onFinish?.();
  }, [onFinish]);

  return {
    pick,
    isApplying: request !== null,
    modal: (
      <Ps4UpdateModal
        shop={shop}
        objectId={objectId}
        request={request}
        onClose={close}
      />
    ),
  };
}
