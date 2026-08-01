import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRightIcon,
  FileDirectoryIcon,
  FileIcon,
  InfoIcon,
  LinkExternalIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";

import type {
  CloudSaveV2FileComparisonStatus,
  CloudSaveV2LocalFile,
  CloudSaveV2RemoteFile,
} from "@types";
import { formatBytes } from "@shared";
import { useDate } from "@renderer/hooks";

import type {
  CloudSaveV2FileTreeDirectory,
  CloudSaveV2FileTreeFile,
  CloudSaveV2FileTreeNode,
  CloudSaveV2FileTreeRoot,
} from "./cloud-save-v2-file-tree";
import { formatCloudSaveV2LocalPath } from "./cloud-save-v2-file-tree";

interface CloudSaveV2FileTreeViewProps {
  roots: CloudSaveV2FileTreeRoot[];
  mode: "local" | "comparison";
  onOpenFolder: (path: string) => void;
  onRebindCustomPath: (rawPath: string) => void;
  onRemoveCustomPath: (rawPath: string) => void;
  customPathActionsDisabled: boolean;
}

const statusTranslationKey: Record<CloudSaveV2FileComparisonStatus, string> = {
  unchanged: "cloud_save_v2_file_unchanged",
  modified: "cloud_save_v2_file_modified",
  "local-only": "cloud_save_v2_file_local_only",
  "remote-only": "cloud_save_v2_file_remote_only",
};

const TREE_LEVEL_INDENT_PX = 24;
const TREE_ROW_PADDING_PX = 8;
const CUSTOM_PATH_STATUS_TOOLTIP_ID = "cloud-save-v2-custom-path-status";

const getRootIdsFromFingerprint = (fingerprint: string) =>
  fingerprint ? fingerprint.split("\u0000") : [];

const getRemoteBranchName = (
  node: CloudSaveV2FileTreeRoot | CloudSaveV2FileTreeDirectory,
  unresolvedDisplayName: string,
  hasUnresolvedCustomPath: boolean
) => {
  if (node.type !== "root") return node.name;
  if (hasUnresolvedCustomPath) return unresolvedDisplayName;
  return node.rawPath;
};

export function CloudSaveV2FileTreeView({
  roots,
  mode,
  onOpenFolder,
  onRebindCustomPath,
  onRemoveCustomPath,
  customPathActionsDisabled,
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

  const fileCell = (
    file: CloudSaveV2LocalFile | CloudSaveV2RemoteFile | null,
    name: string
  ) => {
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

  const folderActions = (
    path: string | null,
    name: string,
    removableCustomRawPath: string | null,
    rebindCustomRawPath: string | null
  ) => {
    if (!path && !removableCustomRawPath && !rebindCustomRawPath) return null;

    return (
      <div className="cloud-save-v2__browser-path-actions">
        {path && (
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
        )}
        {rebindCustomRawPath && (
          <button
            type="button"
            className="cloud-save-v2__browser-path-action cloud-save-v2__browser-path-action--rebind"
            disabled={customPathActionsDisabled}
            onClick={() => onRebindCustomPath(rebindCustomRawPath)}
            title={t("cloud_save_v2_rebind_custom_path")}
            aria-label={t("cloud_save_v2_rebind_custom_path_named", { name })}
          >
            <FileDirectoryIcon size={15} />
            <span>{t("cloud_save_v2_rebind_custom_path")}</span>
          </button>
        )}
        {removableCustomRawPath && (
          <button
            type="button"
            className="cloud-save-v2__browser-path-action cloud-save-v2__browser-path-action--remove"
            disabled={customPathActionsDisabled}
            onClick={() => onRemoveCustomPath(removableCustomRawPath)}
            title={t("cloud_save_v2_remove_custom_path")}
            aria-label={t("cloud_save_v2_remove_custom_path_named", { name })}
          >
            <TrashIcon size={15} />
            <span>{t("cloud_save_v2_remove")}</span>
          </button>
        )}
      </div>
    );
  };

  const renderFileNode = (
    node: CloudSaveV2FileTreeFile,
    contentPaddingLeft: string
  ) => {
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
          {fileCell(node.local ?? node.remote, node.name)}
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
          {fileCell(node.local, node.name)}
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
          {fileCell(node.remote, node.name)}
        </div>
      </li>
    );
  };

  const renderLocalBranchNode = (
    node: CloudSaveV2FileTreeRoot | CloudSaveV2FileTreeDirectory,
    isExpanded: boolean,
    contentPaddingLeft: string,
    displayRootName: string,
    displayLocalDirectoryPath: string | null,
    unresolvedStatusIcon: ReactNode,
    children: ReactNode
  ) => (
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
          <div className="cloud-save-v2__browser-folder-heading">
            <strong
              title={
                node.type === "root"
                  ? displayRootName
                  : (displayLocalDirectoryPath ?? node.name)
              }
            >
              {node.type === "root" ? displayRootName : node.name}
            </strong>
            {unresolvedStatusIcon}
          </div>
        </div>
        {folderActions(
          node.localDirectoryPath,
          node.type === "root" ? displayRootName : node.name,
          node.type === "root" ? node.removableCustomRawPath : null,
          node.type === "root"
            ? (node.unresolvedCustomPath?.rawPath ?? null)
            : null
        )}
      </div>
      {children}
    </li>
  );

  const renderComparisonBranchNode = ({
    node,
    isExpanded,
    hierarchyOffset,
    contentPaddingLeft,
    displayRootName,
    displayLocalDirectoryPath,
    unresolvedStatusIcon,
    remoteName,
    rebindCustomRawPath,
    children,
  }: {
    node: CloudSaveV2FileTreeRoot | CloudSaveV2FileTreeDirectory;
    isExpanded: boolean;
    hierarchyOffset: number;
    contentPaddingLeft: string;
    displayRootName: string;
    displayLocalDirectoryPath: string | null;
    unresolvedStatusIcon: ReactNode;
    remoteName: string;
    rebindCustomRawPath: string | null;
    children: ReactNode;
  }) => (
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
          {node.hasLocalFiles ||
          (node.type === "root" &&
            (node.customPath || node.unresolvedCustomPath)) ? (
            <div className="cloud-save-v2__browser-folder-cell">
              <FileDirectoryIcon
                size={18}
                className="cloud-save-v2__browser-tree-icon"
              />
              <div className="cloud-save-v2__browser-folder-copy">
                <div className="cloud-save-v2__browser-folder-heading">
                  <strong
                    title={
                      node.type === "root"
                        ? displayRootName
                        : (displayLocalDirectoryPath ?? node.name)
                    }
                  >
                    {node.type === "root" ? displayRootName : node.name}
                  </strong>
                  {unresolvedStatusIcon}
                </div>
              </div>
              {folderActions(
                node.localDirectoryPath,
                node.type === "root" ? displayRootName : node.name,
                node.type === "root" ? node.removableCustomRawPath : null,
                rebindCustomRawPath
              )}
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

  const renderNode = (node: CloudSaveV2FileTreeNode, depth: number) => {
    const hierarchyOffset = depth * TREE_LEVEL_INDENT_PX;
    const contentPaddingLeft = `${TREE_ROW_PADDING_PX + hierarchyOffset}px`;

    if (node.type === "file") {
      return renderFileNode(node, contentPaddingLeft);
    }

    const isExpanded = expandedNodeIds.has(node.id);
    const unresolvedCustomPath =
      node.type === "root" ? node.unresolvedCustomPath : null;
    const localName = node.localDirectoryPath ?? node.name;
    const displayLocalName = formatCloudSaveV2LocalPath(localName);
    const displayLocalDirectoryPath = node.localDirectoryPath
      ? formatCloudSaveV2LocalPath(node.localDirectoryPath)
      : null;
    const unresolvedDisplayName = unresolvedCustomPath?.pathHint
      ? formatCloudSaveV2LocalPath(unresolvedCustomPath.pathHint)
      : t("cloud_save_v2_unresolved_custom_path_name");
    const displayRootName = unresolvedCustomPath
      ? unresolvedDisplayName
      : displayLocalName;
    const unresolvedStatus = unresolvedCustomPath
      ? t(`cloud_save_v2_custom_path_reason_${unresolvedCustomPath.reason}`)
      : null;
    const unresolvedStatusIcon = unresolvedStatus ? (
      <button
        type="button"
        className="cloud-save-v2__browser-custom-path-info"
        aria-label={unresolvedStatus}
        data-tooltip-id={CUSTOM_PATH_STATUS_TOOLTIP_ID}
        data-tooltip-content={unresolvedStatus}
      >
        <InfoIcon size={14} />
      </button>
    ) : null;
    const remoteName = getRemoteBranchName(
      node,
      unresolvedDisplayName,
      unresolvedCustomPath !== null
    );
    const childDepth = depth + 1;
    const children = isExpanded ? (
      <ul className="cloud-save-v2__browser-tree-list">
        {node.children.map((child) => renderNode(child, childDepth))}
      </ul>
    ) : null;

    if (mode === "local") {
      return renderLocalBranchNode(
        node,
        isExpanded,
        contentPaddingLeft,
        displayRootName,
        displayLocalDirectoryPath,
        unresolvedStatusIcon,
        children
      );
    }

    return renderComparisonBranchNode({
      node,
      isExpanded,
      hierarchyOffset,
      contentPaddingLeft,
      displayRootName,
      displayLocalDirectoryPath,
      unresolvedStatusIcon,
      remoteName,
      rebindCustomRawPath: unresolvedCustomPath?.rawPath ?? null,
      children,
    });
  };

  return (
    <>
      <ul className="cloud-save-v2__browser-tree-list" role="tree">
        {roots.map((root) => renderNode(root, 0))}
      </ul>
      <Tooltip
        id={CUSTOM_PATH_STATUS_TOOLTIP_ID}
        place="top"
        className="cloud-save-v2__browser-custom-path-tooltip"
      />
    </>
  );
}
