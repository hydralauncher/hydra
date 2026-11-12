import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GameShop, Ps4PkgAccept, Ps4PkgFailure } from "@types";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { setPs4PkgJob } from "@renderer/features";
import {
  PS4_PKG_EXTRACT_REQUEST_EVENT,
  type Ps4PkgExtractRequest,
} from "./ps4-pkg-extract-request";

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
    case "keys_unavailable":
      return "ps4_pkg_keys_unavailable";
    case "game_running":
      return "ps4_update_game_running";
    case "busy":
      return "ps4_pkg_busy";
    default:
      return "ps4_pkg_failed";
  }
};

/**
 * Follows the PS4 PKG job the main process runs (extracting a game, applying
 * an update) into the store, where Downloads, the sidebar and the game page
 * show it. Also asks before extracting a PKG disc on Play. Mounted once.
 */
export function Ps4PkgJobHost() {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const dispatch = useAppDispatch();
  const [extractRequest, setExtractRequest] =
    useState<Ps4PkgExtractRequest | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) =>
      setExtractRequest((event as CustomEvent<Ps4PkgExtractRequest>).detail);
    window.addEventListener(PS4_PKG_EXTRACT_REQUEST_EVENT, onRequest);
    return () =>
      window.removeEventListener(PS4_PKG_EXTRACT_REQUEST_EVENT, onRequest);
  }, []);

  useEffect(
    () =>
      window.electron.onPs4PkgJob((event) => {
        if (event.phase === "start" || event.phase === "progress") {
          dispatch(setPs4PkgJob(event));
          return;
        }

        dispatch(setPs4PkgJob(null));
        if (event.phase === "done" && event.mode === "update") {
          showSuccessToast(
            t("ps4_update_done", { version: event.version ?? "" })
          );
        } else if (event.phase === "error") {
          showErrorToast(t(ps4PkgErrorKey(event.reason)));
        }
      }),
    [dispatch, showSuccessToast, showErrorToast, t]
  );

  const closeRequest = () => setExtractRequest(null);

  const extract = async () => {
    if (!extractRequest) return;
    closeRequest();
    const result = await window.electron
      .extractPs4GamePkg(extractRequest.shop, extractRequest.objectId)
      .catch(() => null);
    // Failures while extracting arrive as job events; these come before it.
    if (result?.reason === "busy" || result?.reason === "unsupported") {
      showErrorToast(t(ps4PkgErrorKey(result.reason)));
    }
  };

  return (
    <ConfirmationModal
      visible={extractRequest !== null}
      title={t("ps4_pkg_extract_title")}
      descriptionText={t("ps4_pkg_extract_description")}
      confirmButtonLabel={t("ps4_pkg_extract_confirm")}
      cancelButtonLabel={t("cancel")}
      onConfirm={() => void extract()}
      onClose={closeRequest}
    />
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
