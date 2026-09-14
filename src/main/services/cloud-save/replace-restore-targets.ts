import type { ReplaceRestoreTarget, ReplaceRestoreTargetsResult } from "@types";

import { NativeAddon } from "../native-addon";

export const replaceRestoreTargets = (
  files: ReplaceRestoreTarget[]
): Promise<ReplaceRestoreTargetsResult> =>
  NativeAddon.replaceRestoreTargets(files);
