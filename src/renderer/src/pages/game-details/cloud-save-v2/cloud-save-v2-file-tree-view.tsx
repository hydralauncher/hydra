import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRightIcon,
  FileDirectoryIcon,
  FileIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import type {
  CloudSaveV2FileComparisonStatus,
  CloudSaveV2LocalFile,
  CloudSaveV2RemoteFile,
} from "@types";
import { formatBytes } from "@shared";
import { useDate } from "@renderer/hooks";

import type {
  CloudSaveV2FileTreeNode,
  CloudSaveV2FileTreeRoot,
} from "./cloud-save-v2-file-tree";
import { formatCloudSaveV2LocalPath } from "./cloud-save-v2-file-tree";

interface CloudSaveV2FileTreeViewProps {
  roots: CloudSaveV2FileTreeRoot[];
  mode: "local" | "comparison";
  onOpenFolder: (path: string) => void;
}

const statusTranslationKey: Record<CloudSaveV2FileComparisonStatus, string> = {
  unchanged: "cloud_save_v2_file_unchanged",
  modified: "cloud_save_v2_file_modified",
  "local-only": "cloud_save_v2_file_local_only",
  "remote-only": "cloud_save_v2_file_remote_only",
};

const TREE_LEVEL_INDENT_PX = 24;
const TREE_ROW_PADDING_PX = 8;

const getRootIdsFromFingerprint = (fingerprint: string) =>
  fingerprint ? fingerprint.split("\u0000") : [];

export function CloudSaveV2FileTreeView({
  roots,
  mode,
  onOpenFolder,
}: Readonly<CloudSaveV2FileTreeViewProps>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const rootFingerprint = useMemo(
    () => roots.map((root) => root.id).join("\u0000"),
    [roots]
  );
  const previousRootIds = useRef(
    new Set(getRootIdsFromFingerprint(rootFingerprint))
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState(
    () => new Set(previousRootIds.current)
  );

  useEffect(() => {
    const nextRootIds = getRootIdsFromFingerprint(rootFingerprint);
    const previous = previousRootIds.current;

    setExpandedNodeIds((current) => {
      const next = new Set(current);
      for (const rootId of nextRootIds) {
        if (!previous.has(rootId)) next.add(rootId);
      }
      return next;
    });
    previousRootIds.current = new Set(nextRootIds);
  }, [rootFingerprint]);

  const toggleNode = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const fileMetadata = (file: CloudSaveV2LocalFile | CloudSaveV2RemoteFile) => (
    <span className="cloud-save-v2__browser-file-metadata">
      <span>{formatBytes(file.sizeBytes)}</span>
      {file.lastModifiedAt && (
        <>
          <span aria-hidden="true">·</span>
          <span>{formatDateTime(file.lastModifiedAt)}</span>
        </>
      )}
    </span>
  );

  const localFileCell = (file: CloudSaveV2LocalFile | null, name: string) => {
    if (!file) {
      return (
        <span className="cloud-save-v2__browser-missing-side" aria-label="—">
          —
        </span>
      );
    }

    return (
      <div className="cloud-save-v2__browser-file-cell">
        <FileIcon size={18} className="cloud-save-v2__browser-tree-icon" />
        <div className="cloud-save-v2__browser-file-copy">
          <div className="cloud-save-v2__browser-file-heading">
            <strong title={name}>{name}</strong>
            {fileMetadata(file)}
          </div>
        </div>
      </div>
    );
  };

  const remoteFileCell = (file: CloudSaveV2RemoteFile | null, name: string) => {
    if (!file) {
      return (
        <span className="cloud-save-v2__browser-missing-side" aria-label="—">
          —
        </span>
      );
    }

    return (
      <div className="cloud-save-v2__browser-file-cell">
        <FileIcon size={18} className="cloud-save-v2__browser-tree-icon" />
        <div className="cloud-save-v2__browser-file-copy">
          <div className="cloud-save-v2__browser-file-heading">
            <strong title={name}>{name}</strong>
            {fileMetadata(file)}
          </div>
        </div>
      </div>
    );
  };

  const folderAction = (path: string | null, name: string) => {
    if (!path) return null;

    return (
      <button
        type="button"
        className="cloud-save-v2__browser-path-action"
        onClick={() => onOpenFolder(path)}
        title={t("cloud_save_v2_open_folder")}
        aria-label={t("cloud_save_v2_open_folder_named", { name })}
      >
        <LinkExternalIcon size={15} />
        <span>{t("cloud_save_v2_open")}</span>
      </button>
    );
  };

  const renderNode = (node: CloudSaveV2FileTreeNode, depth: number) => {
    const hierarchyOffset = depth * TREE_LEVEL_INDENT_PX;
    const contentPaddingLeft = `${TREE_ROW_PADDING_PX + hierarchyOffset}px`;

    if (node.type === "file") {
      if (mode === "local") {
        return (
          <li
            key={node.id}
            role="treeitem"
            aria-selected="false"
            className="cloud-save-v2__browser-local-row"
            style={{ paddingLeft: contentPaddingLeft }}
          >
            <span className="cloud-save-v2__browser-tree-spacer" />
            {localFileCell(node.local, node.name)}
          </li>
        );
      }

      const status = node.status!;
      return (
        <li
          key={node.id}
          role="treeitem"
          aria-selected="false"
          className={`cloud-save-v2__browser-diff-row cloud-save-v2__browser-diff-row--${status}`}
        >
          <span className="cloud-save-v2__browser-tree-spacer" />
          <div
            className="cloud-save-v2__browser-diff-cell"
            style={{ paddingLeft: contentPaddingLeft }}
          >
            {localFileCell(node.local, node.name)}
          </div>
          <div className="cloud-save-v2__browser-status-cell">
            <span
              className={`cloud-save-v2__browser-status cloud-save-v2__browser-status--${status}`}
            >
              {t(statusTranslationKey[status])}
            </span>
          </div>
          <div
            className="cloud-save-v2__browser-diff-cell"
            style={{ paddingLeft: contentPaddingLeft }}
          >
            {remoteFileCell(node.remote, node.name)}
          </div>
        </li>
      );
    }

    const isExpanded = expandedNodeIds.has(node.id);
    const localName = node.localDirectoryPath ?? node.name;
    const displayLocalName = formatCloudSaveV2LocalPath(localName);
    const displayLocalDirectoryPath = node.localDirectoryPath
      ? formatCloudSaveV2LocalPath(node.localDirectoryPath)
      : null;
    const remoteName = node.type === "root" ? node.rawPath : node.name;
    const childDepth = depth + 1;
    const children = isExpanded ? (
      <ul className="cloud-save-v2__browser-tree-list" role="group">
        {node.children.map((child) => renderNode(child, childDepth))}
      </ul>
    ) : null;

    if (mode === "local") {
      return (
        <li
          key={node.id}
          role="treeitem"
          aria-selected="false"
          aria-expanded={isExpanded}
        >
          <div
            className="cloud-save-v2__browser-local-row cloud-save-v2__browser-folder-row"
            style={{ paddingLeft: contentPaddingLeft }}
          >
            <button
              type="button"
              className="cloud-save-v2__browser-tree-toggle"
              aria-expanded={isExpanded}
              onClick={() => toggleNode(node.id)}
            >
              <ChevronRightIcon
                size={15}
                className={`cloud-save-v2__browser-tree-caret ${isExpanded ? "cloud-save-v2__browser-tree-caret--expanded" : ""}`}
              />
            </button>
            <FileDirectoryIcon
              size={18}
              className="cloud-save-v2__browser-tree-icon"
            />
            <div className="cloud-save-v2__browser-folder-copy">
              <strong
                title={
                  node.type === "root"
                    ? displayLocalName
                    : (displayLocalDirectoryPath ?? node.name)
                }
              >
                {node.type === "root" ? displayLocalName : node.name}
              </strong>
              {node.type !== "root" && displayLocalDirectoryPath && (
                <span
                  className="cloud-save-v2__browser-path"
                  title={displayLocalDirectoryPath}
                >
                  {displayLocalDirectoryPath}
                </span>
              )}
            </div>
            {folderAction(node.localDirectoryPath, node.name)}
          </div>
          {children}
        </li>
      );
    }

    return (
      <li
        key={node.id}
        role="treeitem"
        aria-selected="false"
        aria-expanded={isExpanded}
      >
        <div className="cloud-save-v2__browser-diff-row cloud-save-v2__browser-folder-row">
          <button
            type="button"
            className="cloud-save-v2__browser-tree-toggle"
            aria-expanded={isExpanded}
            onClick={() => toggleNode(node.id)}
            style={{ transform: `translateX(${hierarchyOffset}px)` }}
          >
            <ChevronRightIcon
              size={15}
              className={`cloud-save-v2__browser-tree-caret ${isExpanded ? "cloud-save-v2__browser-tree-caret--expanded" : ""}`}
            />
          </button>
          <div
            className="cloud-save-v2__browser-diff-cell"
            style={{ paddingLeft: contentPaddingLeft }}
          >
            {node.hasLocalFiles ? (
              <div className="cloud-save-v2__browser-folder-cell">
                <FileDirectoryIcon
                  size={18}
                  className="cloud-save-v2__browser-tree-icon"
                />
                <div className="cloud-save-v2__browser-folder-copy">
                  <strong
                    title={
                      node.type === "root"
                        ? displayLocalName
                        : (displayLocalDirectoryPath ?? node.name)
                    }
                  >
                    {node.type === "root" ? displayLocalName : node.name}
                  </strong>
                  {node.type !== "root" && displayLocalDirectoryPath && (
                    <span
                      className="cloud-save-v2__browser-path"
                      title={displayLocalDirectoryPath}
                    >
                      {displayLocalDirectoryPath}
                    </span>
                  )}
                </div>
                {folderAction(node.localDirectoryPath, node.name)}
              </div>
            ) : (
              <span className="cloud-save-v2__browser-missing-side">—</span>
            )}
          </div>
          <div className="cloud-save-v2__browser-status-cell" />
          <div
            className="cloud-save-v2__browser-diff-cell"
            style={{ paddingLeft: contentPaddingLeft }}
          >
            {node.hasRemoteFiles ? (
              <div className="cloud-save-v2__browser-folder-cell">
                <FileDirectoryIcon
                  size={18}
                  className="cloud-save-v2__browser-tree-icon"
                />
                <div className="cloud-save-v2__browser-folder-copy">
                  <strong title={remoteName}>{remoteName}</strong>
                </div>
              </div>
            ) : (
              <span className="cloud-save-v2__browser-missing-side">—</span>
            )}
          </div>
        </div>
        {children}
      </li>
    );
  };

  return (
    <ul className="cloud-save-v2__browser-tree-list" role="tree">
      {roots.map((root) => renderNode(root, 0))}
    </ul>
  );
}
