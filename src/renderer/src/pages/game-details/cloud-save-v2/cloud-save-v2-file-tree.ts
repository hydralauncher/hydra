import type {
  CloudSaveCustomPath,
  CloudSaveUnresolvedCustomPath,
  CloudSaveV2FileComparison,
  CloudSaveV2FileComparisonStatus,
  CloudSaveV2LocalFile,
  CloudSaveV2RemoteFile,
} from "@types";

interface CloudSaveV2FileTreeBranchBase {
  id: string;
  name: string;
  children: CloudSaveV2FileTreeNode[];
  localDirectoryPath: string | null;
  hasLocalFiles: boolean;
  hasRemoteFiles: boolean;
}

export interface CloudSaveV2FileTreeRoot extends CloudSaveV2FileTreeBranchBase {
  type: "root";
  rawPath: string;
  customPath: CloudSaveCustomPath | null;
  unresolvedCustomPath: CloudSaveUnresolvedCustomPath | null;
  removableCustomRawPath: string | null;
}

export interface CloudSaveV2FileTreeDirectory
  extends CloudSaveV2FileTreeBranchBase {
  type: "directory";
}

export interface CloudSaveV2FileTreeFile {
  type: "file";
  id: string;
  name: string;
  local: CloudSaveV2LocalFile | null;
  remote: CloudSaveV2RemoteFile | null;
  status: CloudSaveV2FileComparisonStatus | null;
}

export type CloudSaveV2FileTreeNode =
  | CloudSaveV2FileTreeRoot
  | CloudSaveV2FileTreeDirectory
  | CloudSaveV2FileTreeFile;

interface MutableBranch {
  type: "root" | "directory";
  id: string;
  name: string;
  rawPath?: string;
  customPath?: CloudSaveCustomPath;
  unresolvedCustomPath?: CloudSaveUnresolvedCustomPath;
  removableCustomRawPath?: string;
  localDirectoryPath: string | null;
  hasLocalFiles: boolean;
  hasRemoteFiles: boolean;
  branches: Map<string, MutableBranch>;
  files: CloudSaveV2FileTreeFile[];
}

const splitPath = (path: string) =>
  path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

const trimTrailingSeparators = (path: string) => {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) {
    end -= 1;
  }
  return path.slice(0, end);
};

const collapseForwardSeparators = (path: string) => {
  let collapsed = "";
  let previousWasSeparator = false;

  for (const character of path) {
    if (character === "/") {
      if (!previousWasSeparator) collapsed += character;
      previousWasSeparator = true;
    } else {
      collapsed += character;
      previousWasSeparator = false;
    }
  }

  return collapsed;
};

export const formatCloudSaveV2LocalPath = (path: string) => {
  const normalized = path.replaceAll("\\", "/");

  if (normalized.toLowerCase().startsWith("//?/unc/")) {
    return `\\\\${normalized.slice(8).replaceAll("/", "\\")}`;
  }

  const withoutExtendedPrefix = normalized.startsWith("//?/")
    ? normalized.slice(4)
    : normalized;

  if (/^[a-zA-Z]:\//.test(withoutExtendedPrefix)) {
    return withoutExtendedPrefix.replaceAll("/", "\\");
  }

  return path;
};

const getDirectoryPath = (path: string) => {
  const withoutTrailingSeparators = trimTrailingSeparators(path);
  const separatorIndex = Math.max(
    withoutTrailingSeparators.lastIndexOf("\\"),
    withoutTrailingSeparators.lastIndexOf("/")
  );

  if (separatorIndex < 0) return path;
  if (separatorIndex === 0) return withoutTrailingSeparators.slice(0, 1);
  if (
    separatorIndex === 2 &&
    /^[a-zA-Z]:[\\/]/.test(withoutTrailingSeparators)
  ) {
    return withoutTrailingSeparators.slice(0, 3);
  }

  return withoutTrailingSeparators.slice(0, separatorIndex);
};

const getLocalRootPath = (file: CloudSaveV2LocalFile) => {
  let rootPath = file.absolutePath;
  const relativeSegments = splitPath(file.relativePath);
  const levels = Math.max(1, relativeSegments.length);

  for (let index = 0; index < levels; index += 1) {
    rootPath = getDirectoryPath(rootPath);
  }

  return rootPath;
};

const getLocalPathIdentity = (path: string) => {
  const normalizedSeparators = formatCloudSaveV2LocalPath(path).replaceAll(
    "\\",
    "/"
  );
  const isWindowsPath =
    /^[a-zA-Z]:\//.test(normalizedSeparators) ||
    normalizedSeparators.startsWith("//");
  const collapsedSeparators = collapseForwardSeparators(normalizedSeparators);
  const withoutTrailingSeparators =
    collapsedSeparators.length > 1
      ? trimTrailingSeparators(collapsedSeparators)
      : collapsedSeparators;
  const comparablePath = isWindowsPath
    ? withoutTrailingSeparators.toLowerCase()
    : withoutTrailingSeparators;

  return `${isWindowsPath ? "windows" : "unix"}:${comparablePath}`;
};

const joinPath = (rootPath: string, segments: string[]) => {
  if (segments.length === 0) return rootPath;
  const separator =
    rootPath.includes("\\") || /^[a-zA-Z]:/.test(rootPath) ? "\\" : "/";
  const normalizedRoot = trimTrailingSeparators(rootPath);
  return `${normalizedRoot}${separator}${segments.join(separator)}`;
};

const compareTreeNodes = (
  left: CloudSaveV2FileTreeNode,
  right: CloudSaveV2FileTreeNode
) => {
  const leftIsFile = left.type === "file";
  const rightIsFile = right.type === "file";
  if (leftIsFile !== rightIsFile) return leftIsFile ? 1 : -1;

  return (
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.id.localeCompare(right.id)
  );
};

const finalizeBranch = (
  branch: MutableBranch
): CloudSaveV2FileTreeRoot | CloudSaveV2FileTreeDirectory => {
  const children = [
    ...Array.from(branch.branches.values(), finalizeBranch),
    ...branch.files,
  ].sort(compareTreeNodes);
  const shared = {
    id: branch.id,
    name: branch.name,
    children,
    localDirectoryPath: branch.localDirectoryPath,
    hasLocalFiles: branch.hasLocalFiles,
    hasRemoteFiles: branch.hasRemoteFiles,
  };

  if (branch.type === "root") {
    return {
      type: "root",
      rawPath: branch.rawPath!,
      customPath: branch.customPath ?? null,
      unresolvedCustomPath: branch.unresolvedCustomPath ?? null,
      removableCustomRawPath: branch.removableCustomRawPath ?? null,
      ...shared,
    };
  }

  return { type: "directory", ...shared };
};

const updateBranchSources = (
  branch: MutableBranch,
  localDirectoryPath: string | null,
  hasLocalFile: boolean,
  hasRemoteFile: boolean
) => {
  branch.localDirectoryPath ??= localDirectoryPath;
  branch.hasLocalFiles ||= hasLocalFile;
  branch.hasRemoteFiles ||= hasRemoteFile;
};

const getOrCreateComparisonRoot = (
  roots: Map<string, MutableBranch>,
  comparison: CloudSaveV2FileComparison,
  localRootPath: string | null,
  customPath: CloudSaveCustomPath | undefined,
  unresolvedCustomPath: CloudSaveUnresolvedCustomPath | undefined,
  hasLocalFile: boolean,
  hasRemoteFile: boolean
) => {
  const rootId = JSON.stringify([
    "comparison-root",
    comparison.variantId,
    comparison.rawPath,
  ]);
  const existingRoot = roots.get(rootId);
  if (existingRoot) {
    updateBranchSources(
      existingRoot,
      localRootPath,
      hasLocalFile,
      hasRemoteFile
    );
    return existingRoot;
  }

  const identity = comparison.local ?? comparison.remote;
  const root: MutableBranch = {
    type: "root",
    id: rootId,
    name: identity
      ? `${identity.userLabel} · ${comparison.rawPath}`
      : comparison.rawPath,
    rawPath: comparison.rawPath,
    customPath,
    unresolvedCustomPath,
    removableCustomRawPath:
      customPath?.rawPath ?? unresolvedCustomPath?.rawPath,
    localDirectoryPath: localRootPath,
    hasLocalFiles: hasLocalFile,
    hasRemoteFiles: hasRemoteFile,
    branches: new Map(),
    files: [],
  };
  roots.set(rootId, root);
  return root;
};

const getOrCreateComparisonDirectory = (
  parent: MutableBranch,
  comparison: CloudSaveV2FileComparison,
  directorySegments: string[],
  localRootPath: string | null,
  hasLocalFile: boolean,
  hasRemoteFile: boolean
) => {
  const directoryId = JSON.stringify([
    "comparison-directory",
    comparison.variantId,
    comparison.rawPath,
    ...directorySegments,
  ]);
  const localDirectoryPath = localRootPath
    ? joinPath(localRootPath, directorySegments)
    : null;
  const existingDirectory = parent.branches.get(directoryId);
  if (existingDirectory) {
    updateBranchSources(
      existingDirectory,
      localDirectoryPath,
      hasLocalFile,
      hasRemoteFile
    );
    return existingDirectory;
  }

  const directory: MutableBranch = {
    type: "directory",
    id: directoryId,
    name: directorySegments[directorySegments.length - 1],
    localDirectoryPath,
    hasLocalFiles: hasLocalFile,
    hasRemoteFiles: hasRemoteFile,
    branches: new Map(),
    files: [],
  };
  parent.branches.set(directoryId, directory);
  return directory;
};

const addComparisonToTree = (
  roots: Map<string, MutableBranch>,
  comparison: CloudSaveV2FileComparison,
  customPathByRawPath: Map<string, CloudSaveCustomPath>,
  unresolvedCustomPathByRawPath: Map<string, CloudSaveUnresolvedCustomPath>
) => {
  const hasLocalFile = Boolean(comparison.local);
  const hasRemoteFile = Boolean(comparison.remote);
  const customPath = customPathByRawPath.get(comparison.rawPath);
  const unresolvedCustomPath = unresolvedCustomPathByRawPath.get(
    comparison.rawPath
  );
  const localRootPath = comparison.local
    ? getLocalRootPath(comparison.local)
    : (customPath?.path ?? null);
  const root = getOrCreateComparisonRoot(
    roots,
    comparison,
    localRootPath,
    customPath,
    unresolvedCustomPath,
    hasLocalFile,
    hasRemoteFile
  );
  const pathSegments = splitPath(comparison.relativePath);
  const fileName = pathSegments.pop() ?? comparison.relativePath;
  let parent = root;
  const directorySegments: string[] = [];

  for (const segment of pathSegments) {
    directorySegments.push(segment);
    parent = getOrCreateComparisonDirectory(
      parent,
      comparison,
      directorySegments,
      localRootPath,
      hasLocalFile,
      hasRemoteFile
    );
  }

  parent.files.push({
    type: "file",
    id: JSON.stringify([
      "comparison-file",
      comparison.variantId,
      comparison.rawPath,
      comparison.relativePath,
    ]),
    name: fileName,
    local: comparison.local,
    remote: comparison.remote,
    status: comparison.status,
  });
};

export const filterCloudSaveV2Comparisons = (
  comparisons: CloudSaveV2FileComparison[],
  showOnlyChanged: boolean
) =>
  comparisons.filter(
    (comparison) => !showOnlyChanged || comparison.status !== "unchanged"
  );

const addLocalFileToTree = (
  roots: Map<string, MutableBranch>,
  file: CloudSaveV2LocalFile
) => {
  const rootPath = getLocalRootPath(file);
  const rootPathIdentity = getLocalPathIdentity(rootPath);
  const rootId = JSON.stringify(["local-root", rootPathIdentity]);
  let root = roots.get(rootPathIdentity);
  if (!root) {
    root = {
      type: "root",
      id: rootId,
      name: rootPath,
      rawPath: file.rawPath,
      localDirectoryPath: rootPath,
      hasLocalFiles: true,
      hasRemoteFiles: false,
      branches: new Map(),
      files: [],
    };
    roots.set(rootPathIdentity, root);
  }

  const pathSegments = splitPath(file.relativePath);
  const fileName = pathSegments.pop() ?? file.relativePath;
  let parent = root;
  const directorySegments: string[] = [];
  for (const segment of pathSegments) {
    directorySegments.push(segment);
    const localDirectoryPath = joinPath(rootPath, directorySegments);
    const directoryId = JSON.stringify([
      "local-directory",
      getLocalPathIdentity(localDirectoryPath),
    ]);
    let directory = parent.branches.get(directoryId);
    if (!directory) {
      directory = {
        type: "directory",
        id: directoryId,
        name: segment,
        localDirectoryPath,
        hasLocalFiles: true,
        hasRemoteFiles: false,
        branches: new Map(),
        files: [],
      };
      parent.branches.set(directoryId, directory);
    }
    parent = directory;
  }

  parent.files.push({
    type: "file",
    id: JSON.stringify([
      "local-file",
      file.rawPath,
      file.relativePath,
      file.absolutePath,
    ]),
    name: fileName,
    local: file,
    remote: null,
    status: null,
  });
};

const addCustomPathRoot = (
  roots: Map<string, MutableBranch>,
  customPath: CloudSaveCustomPath
) => {
  const rootPathIdentity = getLocalPathIdentity(customPath.path);
  const existing = roots.get(rootPathIdentity);
  if (existing) {
    existing.customPath = customPath;
    existing.removableCustomRawPath = customPath.rawPath;
    return;
  }

  roots.set(rootPathIdentity, {
    type: "root",
    id: JSON.stringify(["local-root", rootPathIdentity]),
    name: customPath.path,
    rawPath: customPath.rawPath,
    customPath,
    removableCustomRawPath: customPath.rawPath,
    localDirectoryPath: customPath.path,
    hasLocalFiles: false,
    hasRemoteFiles: false,
    branches: new Map(),
    files: [],
  });
};

const addUnresolvedCustomPathRoot = (
  roots: Map<string, MutableBranch>,
  unresolvedRootsByRawPath: Map<string, MutableBranch>,
  unresolvedCustomPath: CloudSaveUnresolvedCustomPath
) => {
  const { rawPath } = unresolvedCustomPath;
  const existing = [...roots.values()].find((root) => root.rawPath === rawPath);
  if (existing) {
    existing.unresolvedCustomPath = unresolvedCustomPath;
    existing.removableCustomRawPath = rawPath;
    unresolvedRootsByRawPath.set(rawPath, existing);
    return;
  }

  const rootIdentity = `unresolved:${rawPath}`;
  const root: MutableBranch = {
    type: "root",
    id: JSON.stringify(["unresolved-custom-root", rawPath]),
    name: unresolvedCustomPath.pathHint ?? rawPath,
    rawPath,
    unresolvedCustomPath,
    removableCustomRawPath: rawPath,
    localDirectoryPath: null,
    hasLocalFiles: false,
    hasRemoteFiles: !unresolvedCustomPath.registered,
    branches: new Map(),
    files: [],
  };
  roots.set(rootIdentity, root);
  unresolvedRootsByRawPath.set(rawPath, root);
};

const addUnresolvedRemoteFile = (
  unresolvedRootsByRawPath: Map<string, MutableBranch>,
  file: CloudSaveV2RemoteFile
) => {
  const root = unresolvedRootsByRawPath.get(file.rawPath);
  if (!root) return;

  root.hasRemoteFiles = true;
  const pathSegments = splitPath(file.relativePath);
  const fileName = pathSegments.pop() ?? file.relativePath;
  let parent = root;
  const directorySegments: string[] = [];
  for (const segment of pathSegments) {
    directorySegments.push(segment);
    const directoryId = JSON.stringify([
      "unresolved-remote-directory",
      file.rawPath,
      ...directorySegments,
    ]);
    let directory = parent.branches.get(directoryId);
    if (!directory) {
      directory = {
        type: "directory",
        id: directoryId,
        name: segment,
        localDirectoryPath: null,
        hasLocalFiles: false,
        hasRemoteFiles: true,
        branches: new Map(),
        files: [],
      };
      parent.branches.set(directoryId, directory);
    } else {
      directory.hasRemoteFiles = true;
    }
    parent = directory;
  }

  parent.files.push({
    type: "file",
    id: JSON.stringify([
      "unresolved-remote-file",
      file.variantId,
      file.rawPath,
      file.relativePath,
    ]),
    name: fileName,
    local: null,
    remote: file,
    status: null,
  });
};

export const buildCloudSaveV2LocalFileTree = (
  files: CloudSaveV2LocalFile[],
  customPaths: CloudSaveCustomPath[] = [],
  unresolvedCustomPaths: CloudSaveUnresolvedCustomPath[] = [],
  remoteFiles: CloudSaveV2RemoteFile[] = []
): CloudSaveV2FileTreeRoot[] => {
  const roots = new Map<string, MutableBranch>();
  const unresolvedRootsByRawPath = new Map<string, MutableBranch>();

  for (const file of files) {
    addLocalFileToTree(roots, file);
  }

  for (const customPath of customPaths) {
    addCustomPathRoot(roots, customPath);
  }

  for (const unresolvedCustomPath of unresolvedCustomPaths) {
    addUnresolvedCustomPathRoot(
      roots,
      unresolvedRootsByRawPath,
      unresolvedCustomPath
    );
  }

  for (const file of remoteFiles) {
    addUnresolvedRemoteFile(unresolvedRootsByRawPath, file);
  }

  return Array.from(roots.values(), finalizeBranch).sort(
    compareTreeNodes
  ) as CloudSaveV2FileTreeRoot[];
};

export const buildCloudSaveV2ComparisonTree = (
  comparisons: CloudSaveV2FileComparison[],
  customPaths: CloudSaveCustomPath[] = [],
  unresolvedCustomPaths: CloudSaveUnresolvedCustomPath[] = []
): CloudSaveV2FileTreeRoot[] => {
  const roots = new Map<string, MutableBranch>();
  const customPathByRawPath = new Map(
    customPaths.map((customPath) => [customPath.rawPath, customPath])
  );
  const unresolvedCustomPathByRawPath = new Map(
    unresolvedCustomPaths.map((customPath) => [customPath.rawPath, customPath])
  );

  for (const comparison of comparisons) {
    addComparisonToTree(
      roots,
      comparison,
      customPathByRawPath,
      unresolvedCustomPathByRawPath
    );
  }

  for (const unresolvedCustomPath of unresolvedCustomPaths) {
    if (
      [...roots.values()].some(
        (root) => root.rawPath === unresolvedCustomPath.rawPath
      )
    ) {
      continue;
    }

    const { rawPath } = unresolvedCustomPath;
    const rootId = JSON.stringify(["comparison-unresolved-root", rawPath]);
    roots.set(rootId, {
      type: "root",
      id: rootId,
      name: unresolvedCustomPath.pathHint ?? rawPath,
      rawPath,
      unresolvedCustomPath,
      removableCustomRawPath: rawPath,
      localDirectoryPath: null,
      hasLocalFiles: false,
      hasRemoteFiles: !unresolvedCustomPath.registered,
      branches: new Map(),
      files: [],
    });
  }

  return Array.from(roots.values(), finalizeBranch).sort(
    compareTreeNodes
  ) as CloudSaveV2FileTreeRoot[];
};
