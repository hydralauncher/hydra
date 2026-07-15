import type {
  VerifyDownloadedRestoreFileInput,
  VerifyDownloadedRestoreFileResult,
} from "@types";

import { NativeAddon } from "../native-addon";

export const verifyDownloadedRestoreFile = (
  input: VerifyDownloadedRestoreFileInput
): Promise<VerifyDownloadedRestoreFileResult> =>
  NativeAddon.verifyDownloadedRestoreFile(input.tempPath, input.expectedHash);
