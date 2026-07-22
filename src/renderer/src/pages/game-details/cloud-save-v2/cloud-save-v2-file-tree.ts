import type {
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
  const withoutTrailingSeparators = path.replace(/[\\/]+$/, "");
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
  const collapsedSeparators = normalizedSeparators.replace(/\/+/g, "/");
  const withoutTrailingSeparators =
    collapsedSeparators.length > 1
      ? collapsedSeparators.replace(/\/+$/, "")
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
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
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

export const filterCloudSaveV2Comparisons = (
  comparisons: CloudSaveV2FileComparison[],
  showOnlyChanged: boolean
) =>
  comparisons.filter(
    (comparison) => !showOnlyChanged || comparison.status !== "unchanged"
  );

export const buildCloudSaveV2LocalFileTree = (
  files: CloudSaveV2LocalFile[]
): CloudSaveV2FileTreeRoot[] => {
  const roots = new Map<string, MutableBranch>();

  for (const file of files) {
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
  }

  return Array.from(roots.values(), finalizeBranch).sort(
    compareTreeNodes
  ) as CloudSaveV2FileTreeRoot[];
};

export const buildCloudSaveV2ComparisonTree = (
  comparisons: CloudSaveV2FileComparison[]
): CloudSaveV2FileTreeRoot[] => {
  const roots = new Map<string, MutableBranch>();

  for (const comparison of comparisons) {
    const rootId = JSON.stringify(["comparison-root", comparison.rawPath]);
    const localRootPath = comparison.local
      ? getLocalRootPath(comparison.local)
      : null;
    let root = roots.get(rootId);
    if (!root) {
      root = {
        type: "root",
        id: rootId,
        name: comparison.rawPath,
        rawPath: comparison.rawPath,
        localDirectoryPath: localRootPath,
        hasLocalFiles: Boolean(comparison.local),
        hasRemoteFiles: Boolean(comparison.remote),
        branches: new Map(),
        files: [],
      };
      roots.set(rootId, root);
    } else {
      updateBranchSources(
        root,
        localRootPath,
        Boolean(comparison.local),
        Boolean(comparison.remote)
      );
    }

    const pathSegments = splitPath(comparison.relativePath);
    const fileName = pathSegments.pop() ?? comparison.relativePath;
    let parent = root;
    const directorySegments: string[] = [];

    for (const segment of pathSegments) {
      directorySegments.push(segment);
      const directoryId = JSON.stringify([
        "comparison-directory",
        comparison.rawPath,
        ...directorySegments,
      ]);
      const localDirectoryPath = localRootPath
        ? joinPath(localRootPath, directorySegments)
        : null;
      let directory = parent.branches.get(directoryId);
      if (!directory) {
        directory = {
          type: "directory",
          id: directoryId,
          name: segment,
          localDirectoryPath,
          hasLocalFiles: Boolean(comparison.local),
          hasRemoteFiles: Boolean(comparison.remote),
          branches: new Map(),
          files: [],
        };
        parent.branches.set(directoryId, directory);
      } else {
        updateBranchSources(
          directory,
          localDirectoryPath,
          Boolean(comparison.local),
          Boolean(comparison.remote)
        );
      }
      parent = directory;
    }

    parent.files.push({
      type: "file",
      id: JSON.stringify([
        "comparison-file",
        comparison.rawPath,
        comparison.relativePath,
      ]),
      name: fileName,
      local: comparison.local,
      remote: comparison.remote,
      status: comparison.status,
    });
  }

  return Array.from(roots.values(), finalizeBranch).sort(
    compareTreeNodes
  ) as CloudSaveV2FileTreeRoot[];
};
