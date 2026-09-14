import type { ShouldSkipRestoreFileInput } from "@types";

import { NativeAddon } from "../native-addon";

export const shouldSkipRestoreFile = (
  input: ShouldSkipRestoreFileInput
): Promise<boolean> => NativeAddon.shouldSkipRestoreFile(input);
