import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  GameShop,
  Ps4PkgAccept,
  Ps4PkgFailure,
  Ps4PkgJobMode,
} from "@types";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { setPs4PkgJob } from "@renderer/features";
import {
  PS4_PKG_EXTRACT_REQUEST_EVENT,
  requestPs4PkgExtraction,
  type Ps4PkgExtractRequest,
} from "./ps4-pkg-extract-request";

const FAILURES_BEFORE_JOB = new Set<Ps4PkgFailure>([
  "busy",
  "unsupported",
  "game_running",
  "not_update",
  "not_dlc",
  "dlc_installed",
  "other_game",
  "no_game_folder",
  "not_newer",
]);

export const ps4PkgErrorKey = (reason?: Ps4PkgFailure) => {
  switch (reason) {
    case "not_update":
      return "ps4_update_not_update";
    case "not_dlc":
      return "ps4_dlc_not_dlc";
    case "dlc_installed":
      return "ps4_dlc_installed";
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
 * show it. Also asks before extracting a PKG disc on Play, or a PKG picked
 * with Add disc. Mounted once.
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
        } else if (event.phase === "done" && event.mode === "dlc") {
          showSuccessToast(t("ps4_dlc_done"));
        } else if (event.phase === "error") {
          showErrorToast(t(ps4PkgErrorKey(event.reason)));
        }
      }),
    [dispatch, showSuccessToast, showErrorToast, t]
  );

  const closeRequest = () => {
    extractRequest?.onFinish?.();
    setExtractRequest(null);
  };

  const decline = () => {
    extractRequest?.onDecline?.();
    closeRequest();
  };

  const runRequest = async (request: Ps4PkgExtractRequest) => {
    const { shop, objectId, pkgPath } = request;
    if (request.mode === "update" && pkgPath) {
      return window.electron.applyPs4Update(shop, objectId, pkgPath);
    }
    if (request.mode === "dlc" && pkgPath) {
      return window.electron.applyPs4Dlc(shop, objectId, pkgPath);
    }
    return window.electron.extractPs4GamePkg(shop, objectId, pkgPath ?? null);
  };

  const extract = async () => {
    if (!extractRequest) return;
    const request = extractRequest;
    setExtractRequest(null);
    const result = await runRequest(request).catch(() => null);
    request.onFinish?.();
    // Failures while extracting arrive as job events; these come before it.
    if (result?.reason && FAILURES_BEFORE_JOB.has(result.reason)) {
      showErrorToast(t(ps4PkgErrorKey(result.reason)));
    }
  };

  const mode = extractRequest?.mode ?? "extract";
  const isAddingPkg = Boolean(extractRequest?.onDecline);
  const getCopy = () => {
    if (mode === "update") {
      return {
        title: extractRequest?.version
          ? t("ps4_pkg_apply_update_title", {
              version: extractRequest.version,
            })
          : t("apply_ps4_update"),
        description: t("ps4_pkg_apply_update_description"),
        confirm: t("ps4_pkg_apply_confirm"),
      };
    }
    if (mode === "dlc") {
      return {
        title: t("apply_ps4_dlc"),
        description: t("ps4_pkg_apply_dlc_description"),
        confirm: t("ps4_pkg_apply_confirm"),
      };
    }
    return {
      title: t("ps4_pkg_extract_title"),
      description: t(
        isAddingPkg
          ? "ps4_pkg_add_extract_description"
          : "ps4_pkg_extract_description"
      ),
      confirm: t("ps4_pkg_extract_confirm"),
    };
  };
  const copy = getCopy();

  return (
    <ConfirmationModal
      visible={extractRequest !== null}
      title={copy.title}
      descriptionText={copy.description}
      confirmButtonLabel={copy.confirm}
      cancelButtonLabel={
        isAddingPkg && mode === "extract"
          ? t("ps4_pkg_extract_later")
          : t("cancel")
      }
      onConfirm={() => void extract()}
      onCancel={isAddingPkg && mode === "extract" ? decline : closeRequest}
      onClose={closeRequest}
    />
  );
}

const runPs4PkgMode = (
  mode: Ps4PkgJobMode,
  shop: GameShop,
  objectId: string,
  pkgPath: string
) => {
  if (mode === "update") {
    return window.electron.applyPs4Update(shop, objectId, pkgPath);
  }
  if (mode === "dlc")
    return window.electron.applyPs4Dlc(shop, objectId, pkgPath);
  return window.electron.extractPs4GamePkg(shop, objectId, pkgPath);
};

/**
 * Picks a PS4 PKG and starts the matching job: an update over the game
 * folder, or (with "any") extracting a game PKG into a new disc. With "any"
 * it asks first, and a game PKG the user skips is added as a PKG disc.
 */
export function usePs4PkgPicker(
  shop: GameShop,
  objectId: string,
  accept: Ps4PkgAccept,
  onFinish?: () => void,
  onKeepPkg?: (pkgPath: string) => Promise<void> | void
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
    let isAsking = false;
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

      if (accept === "any") {
        isAsking = true;
        requestPs4PkgExtraction({
          shop,
          objectId,
          pkgPath,
          mode:
            check.mode === "update" || check.mode === "dlc"
              ? check.mode
              : "extract",
          version: check.version,
          onDecline: onKeepPkg ? () => void onKeepPkg(pkgPath) : undefined,
          onFinish: () => {
            setIsBusy(false);
            onFinish?.();
          },
        });
        return;
      }

      const result = await runPs4PkgMode(check.mode, shop, objectId, pkgPath);
      if (result.reason === "busy") showErrorToast(t("ps4_pkg_busy"));
    } finally {
      if (!isAsking) {
        setIsBusy(false);
        onFinish?.();
      }
    }
  };

  return { pick, isBusy };
}
