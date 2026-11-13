import type { GameShop } from "@types";

/** Window event asking before a PS4 PKG is extracted or applied. */
export const PS4_PKG_EXTRACT_REQUEST_EVENT = "hydra:ps4-pkg-extract-request";

export interface Ps4PkgExtractRequest {
  shop: GameShop;
  objectId: string;
  pkgPath?: string;
  mode?: "extract" | "update" | "dlc";
  version?: string | null;
  onDecline?: () => void;
  onFinish?: () => void;
}

export const requestPs4PkgExtraction = (request: Ps4PkgExtractRequest) =>
  window.dispatchEvent(
    new CustomEvent(PS4_PKG_EXTRACT_REQUEST_EVENT, { detail: request })
  );
