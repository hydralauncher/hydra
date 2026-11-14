import type { GameShop } from "@types";

/** Window event asking to extract a game's PS4 PKG disc before it plays. */
export const PS4_PKG_EXTRACT_REQUEST_EVENT = "hydra:ps4-pkg-extract-request";

export interface Ps4PkgExtractRequest {
  shop: GameShop;
  objectId: string;
}

export const requestPs4PkgExtraction = (request: Ps4PkgExtractRequest) =>
  window.dispatchEvent(
    new CustomEvent(PS4_PKG_EXTRACT_REQUEST_EVENT, { detail: request })
  );
