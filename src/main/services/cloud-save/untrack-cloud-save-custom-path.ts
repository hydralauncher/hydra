import type { GameShop } from "@types";

import { dismissPendingCloudSaveCustomPathApprovalForRawPath } from "./custom-path-approval.js";
import { ignoreCloudSaveCustomPath } from "./custom-path-store.js";
import { executeCloudSaveCustomPathUntracking } from "./custom-path-untracking-policy.js";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate.js";

export const untrackCloudSaveCustomPath = (
  objectId: string,
  shop: GameShop,
  rawPath: string
) => {
  if (!rawPath.startsWith("<custom>")) {
    throw new Error("cloud_save_custom_path_invalid");
  }

  const scopeKey = cloudSaveOperationScopeKey(objectId, shop);
  return cloudSaveOperationGate.runSync(
    scopeKey,
    JSON.stringify(["untrack-custom-path", rawPath]),
    () =>
      executeCloudSaveCustomPathUntracking({
        ignore: () => ignoreCloudSaveCustomPath(shop, objectId, rawPath),
        dismissPendingApproval: () =>
          dismissPendingCloudSaveCustomPathApprovalForRawPath(
            shop,
            objectId,
            rawPath
          ),
      })
  );
};
