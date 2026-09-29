import path from "node:path";

import type { EmulatorDiscoveredFile } from "./emulator-provider-types";

export const emulatorProviderSourcePaths = (file: EmulatorDiscoveredFile) => {
  const paths = [file.absolutePath];
  // Dolphin hashes a canonical GCI copy. A manually selected source GCI must
  // not become a second, uncanonicalized entry in the same snapshot.
  if (file.rawPath.startsWith("<emulator>/dolphin-gci/")) {
    paths.push(path.join(file.localBindings.concretePath, file.relativePath));
  }
  return paths;
};
