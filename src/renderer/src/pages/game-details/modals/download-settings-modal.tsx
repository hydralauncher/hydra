import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  CheckboxField,
  Link,
  Modal,
  SelectField,
  TextField,
} from "@renderer/components";
import {
  DownloadIcon,
  SyncIcon,
  CheckCircleFillIcon,
  CheckIcon,
  PlusIcon,
  ChevronDownIcon,
  FileDirectoryIcon,
  FileIcon,
} from "@primer/octicons-react";
import {
  DownloadError,
  Downloader,
  formatBytes,
  getDownloadersForUri,
} from "@shared";
import type { GameRepack, TorrentFile, TorrentFilesResponse } from "@types";
import { DOWNLOADER_NAME } from "@renderer/constants";
import {
  useAppSelector,
  useDownload,
  useFeature,
  useToast,
} from "@renderer/hooks";
import { motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import { RealDebridInfoModal } from "./real-debrid-info-modal";
import "./download-settings-modal.scss";

export interface DownloadSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly?: boolean,
    fileIndices?: number[],
    selectedFilesSize?: number | null
  ) => Promise<{ ok: boolean; error?: string }>;
  repack: GameRepack | null;
}

type TorrentSortColumn = "name" | "size" | "downloading";
type TorrentSortDirection = "asc" | "desc";

const parseTorrentSortOption = (
  value: string
): { column: TorrentSortColumn; direction: TorrentSortDirection } => {
  const [column, direction] = value.split("_");

  if (
    (column === "name" || column === "size" || column === "downloading") &&
    (direction === "asc" || direction === "desc")
  ) {
    return { column, direction };
  }

  return { column: "name", direction: "asc" };
};

interface TorrentFolderNode {
  id: string;
  name: string;
  parentId: string | null;
  childFolderIds: string[];
  directFileIndices: number[];
  allFileIndices: number[];
  totalSize: number;
}

type TorrentTreeRow =
  | {
      key: string;
      type: "folder";
      folderId: string;
      depth: number;
      name: string;
      totalSize: number;
      selectedCount: number;
      totalCount: number;
      expanded: boolean;
    }
  | {
      key: string;
      type: "file";
      file: TorrentFile;
      depth: number;
      name: string;
      selected: boolean;
    };

type FolderTorrentTreeRow = Extract<TorrentTreeRow, { type: "folder" }>;
type FileTorrentTreeRow = Extract<TorrentTreeRow, { type: "file" }>;

interface TorrentTreeData {
  ROOT_ID: string;
  folders: Map<string, TorrentFolderNode>;
  rootFolderIds: string[];
  rootFileIndices: number[];
  fileNameByIndex: Map<number, string>;
}

const ROOT_TORRENT_FOLDER_ID = "__root__";

const createTorrentFolderNode = (
  id: string,
  name: string,
  parentId: string | null
): TorrentFolderNode => ({
  id,
  name,
  parentId,
  childFolderIds: [],
  directFileIndices: [],
  allFileIndices: [],
  totalSize: 0,
});

const addFileToTorrentTree = (
  file: TorrentFile,
  folders: Map<string, TorrentFolderNode>,
  fileNameByIndex: Map<number, string>
) => {
  const rootNode = folders.get(ROOT_TORRENT_FOLDER_ID);
  if (!rootNode) return;

  const normalizedPath = file.path.replaceAll("\\", "/");
  const pathParts = normalizedPath.split("/").filter(Boolean);
  const fileName = pathParts.at(-1) ?? file.path;
  fileNameByIndex.set(file.index, fileName);

  if (pathParts.length <= 1) {
    rootNode.directFileIndices.push(file.index);
    return;
  }

  let parentFolderId = ROOT_TORRENT_FOLDER_ID;
  let folderPath = "";

  pathParts.slice(0, -1).forEach((segment) => {
    folderPath = folderPath ? `${folderPath}/${segment}` : segment;

    if (!folders.has(folderPath)) {
      folders.set(
        folderPath,
        createTorrentFolderNode(
          folderPath,
          segment,
          parentFolderId === ROOT_TORRENT_FOLDER_ID ? null : parentFolderId
        )
      );
      folders.get(parentFolderId)?.childFolderIds.push(folderPath);
    }

    parentFolderId = folderPath;
  });

  folders.get(parentFolderId)?.directFileIndices.push(file.index);
};

const computeTorrentFolderInfo = (
  folderId: string,
  folders: Map<string, TorrentFolderNode>,
  torrentFilesByIndex: Map<number, TorrentFile>
): number[] => {
  const folder = folders.get(folderId);
  if (!folder) return [];

  const nestedFileIndices = folder.childFolderIds.flatMap((childFolderId) =>
    computeTorrentFolderInfo(childFolderId, folders, torrentFilesByIndex)
  );

  folder.allFileIndices = [...folder.directFileIndices, ...nestedFileIndices];
  folder.totalSize = folder.allFileIndices.reduce(
    (sum, index) => sum + (torrentFilesByIndex.get(index)?.length ?? 0),
    0
  );

  return folder.allFileIndices;
};

const buildTorrentTreeData = (
  torrentFiles: TorrentFile[],
  torrentFilesByIndex: Map<number, TorrentFile>
): TorrentTreeData => {
  const folders = new Map<string, TorrentFolderNode>();
  const rootNode = createTorrentFolderNode(ROOT_TORRENT_FOLDER_ID, "", null);
  const fileNameByIndex = new Map<number, string>();

  folders.set(ROOT_TORRENT_FOLDER_ID, rootNode);
  torrentFiles.forEach((file) => {
    addFileToTorrentTree(file, folders, fileNameByIndex);
  });

  computeTorrentFolderInfo(
    ROOT_TORRENT_FOLDER_ID,
    folders,
    torrentFilesByIndex
  );

  return {
    ROOT_ID: ROOT_TORRENT_FOLDER_ID,
    folders,
    rootFolderIds: [...rootNode.childFolderIds],
    rootFileIndices: [...rootNode.directFileIndices],
    fileNameByIndex,
  };
};

export function DownloadSettingsModal({
  visible,
  onClose,
  startDownload,
  repack,
}: Readonly<DownloadSettingsModalProps>) {
  const { t } = useTranslation("game_details");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { lastPacket } = useDownload();
  const { showErrorToast } = useToast();

  const hasActiveDownload = lastPacket !== null;

  const [diskFreeSpace, setDiskFreeSpace] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [automaticExtractionEnabled, setAutomaticExtractionEnabled] = useState(
    userPreferences?.extractFilesByDefault ?? true
  );
  const [selectedDownloader, setSelectedDownloader] =
    useState<Downloader | null>(null);
  const [hasWritePermission, setHasWritePermission] = useState<boolean | null>(
    null
  );
  const [showRealDebridModal, setShowRealDebridModal] = useState(false);
  const [torrentFiles, setTorrentFiles] = useState<TorrentFile[]>([]);
  const [torrentFilesLoading, setTorrentFilesLoading] = useState(false);
  const [torrentFilesError, setTorrentFilesError] = useState<string | null>(
    null
  );
  const [torrentFileSearch, setTorrentFileSearch] = useState("");
  const [selectedTorrentIndices, setSelectedTorrentIndices] = useState<
    Set<number>
  >(new Set());
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    new Set()
  );
  const [showTorrentStepModal, setShowTorrentStepModal] = useState(false);
  const [torrentSort, setTorrentSort] = useState<{
    column: TorrentSortColumn;
    direction: TorrentSortDirection;
  }>({ column: "name", direction: "asc" });
  const torrentFilesCache = useRef<Map<string, TorrentFilesResponse>>(
    new Map()
  );

  const { isFeatureEnabled, Feature } = useFeature();

  const selectedUri = useMemo(() => {
    if (!repack || selectedDownloader === null) return null;

    return (
      repack.uris.find((uri) =>
        getDownloadersForUri(uri).includes(selectedDownloader)
      ) ?? null
    );
  }, [repack, selectedDownloader]);

  const selectedMagnetUri = useMemo(() => {
    if (selectedDownloader !== Downloader.Torrent) return null;
    if (!selectedUri?.startsWith("magnet:")) return null;
    return selectedUri;
  }, [selectedDownloader, selectedUri]);

  const getDiskFreeSpace = async (path: string) => {
    const result = await globalThis.electron.getDiskFreeSpace(path);
    setDiskFreeSpace(result.free);
  };

  const checkFolderWritePermission = useCallback(
    async (path: string) => {
      if (isFeatureEnabled(Feature.CheckDownloadWritePermission)) {
        const result =
          await globalThis.electron.checkFolderWritePermission(path);
        setHasWritePermission(result);
      } else {
        setHasWritePermission(true);
      }
    },
    [Feature, isFeatureEnabled]
  );

  useEffect(() => {
    if (visible) {
      getDiskFreeSpace(selectedPath);
      checkFolderWritePermission(selectedPath);
    }
  }, [visible, checkFolderWritePermission, selectedPath]);

  const downloadOptions = useMemo(() => {
    const unavailableUrisSet = new Set(repack?.unavailableUris ?? []);

    const downloaderMap = new Map<
      Downloader,
      { hasAvailable: boolean; hasUnavailable: boolean }
    >();

    if (repack) {
      for (const uri of repack.uris) {
        const uriDownloaders = getDownloadersForUri(uri);
        const isAvailable = !unavailableUrisSet.has(uri);

        for (const downloader of uriDownloaders) {
          const existing = downloaderMap.get(downloader);
          if (existing) {
            existing.hasAvailable = existing.hasAvailable || isAvailable;
            existing.hasUnavailable = existing.hasUnavailable || !isAvailable;
          } else {
            downloaderMap.set(downloader, {
              hasAvailable: isAvailable,
              hasUnavailable: !isAvailable,
            });
          }
        }
      }
    }

    const allDownloaders = Object.values(Downloader).filter(
      (value) => typeof value === "number"
    ) as Downloader[];

    const getDownloaderPriority = (option: {
      isAvailable: boolean;
      canHandle: boolean;
      isAvailableButNotConfigured: boolean;
    }) => {
      if (option.isAvailable) return 0;
      if (option.canHandle && !option.isAvailableButNotConfigured) return 1;
      if (option.isAvailableButNotConfigured) return 2;
      return 3;
    };

    return allDownloaders
      .filter((downloader) => {
        if (downloader === Downloader.Hydra) return false; // Temporarily comment out Nimbus
        if (
          downloader === Downloader.Premiumize &&
          !isFeatureEnabled(Feature.Premiumize)
        ) {
          return false;
        }

        if (
          downloader === Downloader.AllDebrid &&
          !isFeatureEnabled(Feature.AllDebrid)
        ) {
          return false;
        }

        return true;
      })
      .map((downloader) => {
        const status = downloaderMap.get(downloader);
        const canHandle = status !== undefined;
        const hasAvailableUri = status?.hasAvailable ?? false;

        let isConfigured = true;
        if (downloader === Downloader.RealDebrid) {
          isConfigured = !!userPreferences?.realDebridApiToken;
        } else if (downloader === Downloader.Premiumize) {
          isConfigured = !!userPreferences?.premiumizeApiToken;
        } else if (downloader === Downloader.AllDebrid) {
          isConfigured = !!userPreferences?.allDebridApiToken;
        } else if (downloader === Downloader.TorBox) {
          isConfigured = !!userPreferences?.torBoxApiToken;
        }
        // } else if (downloader === Downloader.Hydra) {
        //   isConfigured = isFeatureEnabled(Feature.Nimbus);
        // }

        const isAvailableButNotConfigured =
          hasAvailableUri && !isConfigured && canHandle;

        const isAvailable = hasAvailableUri && isConfigured;

        return {
          downloader,
          isAvailable,
          canHandle,
          isAvailableButNotConfigured,
        };
      })
      .sort((a, b) => getDownloaderPriority(a) - getDownloaderPriority(b));
  }, [
    repack,
    userPreferences?.realDebridApiToken,
    userPreferences?.premiumizeApiToken,
    userPreferences?.allDebridApiToken,
    userPreferences?.torBoxApiToken,
    isFeatureEnabled,
    Feature,
  ]);

  const getDefaultDownloader = useCallback(
    (availableDownloaders: Downloader[]) => {
      if (availableDownloaders.length === 0) return null;

      if (availableDownloaders.includes(Downloader.RealDebrid)) {
        return Downloader.RealDebrid;
      }

      if (availableDownloaders.includes(Downloader.Premiumize)) {
        return Downloader.Premiumize;
      }

      if (availableDownloaders.includes(Downloader.AllDebrid)) {
        return Downloader.AllDebrid;
      }

      if (availableDownloaders.includes(Downloader.TorBox)) {
        return Downloader.TorBox;
      }

      return availableDownloaders[0];
    },
    []
  );

  useEffect(() => {
    if (userPreferences?.downloadsPath) {
      setSelectedPath(userPreferences.downloadsPath);
    } else {
      globalThis.electron
        .getDefaultDownloadsPath()
        .then((defaultDownloadsPath) => setSelectedPath(defaultDownloadsPath));
    }

    const availableDownloaders = downloadOptions
      .filter((option) => option.isAvailable)
      .map((option) => option.downloader);

    setSelectedDownloader(getDefaultDownloader(availableDownloaders));
  }, [getDefaultDownloader, userPreferences?.downloadsPath, downloadOptions]);

  const torrentFilesByIndex = useMemo(() => {
    const fileMap = new Map<number, TorrentFile>();
    torrentFiles.forEach((file) => fileMap.set(file.index, file));
    return fileMap;
  }, [torrentFiles]);

  const selectedTorrentSize = useMemo(() => {
    let total = 0;
    selectedTorrentIndices.forEach((index) => {
      total += torrentFilesByIndex.get(index)?.length ?? 0;
    });
    return total;
  }, [selectedTorrentIndices, torrentFilesByIndex]);

  const torrentTree = useMemo(
    () => buildTorrentTreeData(torrentFiles, torrentFilesByIndex),
    [torrentFiles, torrentFilesByIndex]
  );

  const normalizedTorrentSearch = torrentFileSearch.trim().toLowerCase();

  const folderSelectedCountById = useMemo(() => {
    const selectedCountMap = new Map<string, number>();

    torrentTree.folders.forEach((folder, folderId) => {
      const selectedCount = folder.allFileIndices.reduce(
        (count, index) =>
          selectedTorrentIndices.has(index) ? count + 1 : count,
        0
      );
      selectedCountMap.set(folderId, selectedCount);
    });

    return selectedCountMap;
  }, [selectedTorrentIndices, torrentTree]);

  const filteredTorrentRows = useMemo(() => {
    const directionMultiplier = torrentSort.direction === "asc" ? 1 : -1;

    const compareFileIndices = (aIndex: number, bIndex: number) => {
      const aFile = torrentFilesByIndex.get(aIndex);
      const bFile = torrentFilesByIndex.get(bIndex);
      if (!aFile || !bFile) return 0;

      if (torrentSort.column === "name") {
        const nameComparison = (
          torrentTree.fileNameByIndex.get(aIndex) ?? ""
        ).localeCompare(torrentTree.fileNameByIndex.get(bIndex) ?? "");
        return nameComparison * directionMultiplier;
      }

      if (torrentSort.column === "size") {
        return (aFile.length - bFile.length) * directionMultiplier;
      }

      const aSelected = selectedTorrentIndices.has(aIndex);
      const bSelected = selectedTorrentIndices.has(bIndex);
      const downloadingComparison = Number(aSelected) - Number(bSelected);

      return downloadingComparison * directionMultiplier;
    };

    const compareFolderIds = (aFolderId: string, bFolderId: string) => {
      const aFolder = torrentTree.folders.get(aFolderId);
      const bFolder = torrentTree.folders.get(bFolderId);
      if (!aFolder || !bFolder) return 0;

      let comparison = 0;
      if (torrentSort.column === "name") {
        comparison = aFolder.name.localeCompare(bFolder.name);
      } else if (torrentSort.column === "size") {
        comparison = aFolder.totalSize - bFolder.totalSize;
      } else {
        const aCount = folderSelectedCountById.get(aFolderId) ?? 0;
        const bCount = folderSelectedCountById.get(bFolderId) ?? 0;
        const aRatio = aFolder.allFileIndices.length
          ? aCount / aFolder.allFileIndices.length
          : 0;
        const bRatio = bFolder.allFileIndices.length
          ? bCount / bFolder.allFileIndices.length
          : 0;
        comparison = aRatio - bRatio;
      }

      return comparison * directionMultiplier;
    };

    const matchesSearch = (text: string) =>
      !normalizedTorrentSearch ||
      text.toLowerCase().includes(normalizedTorrentSearch);

    const matchingFileIndices = new Set<number>();
    torrentFiles.forEach((file) => {
      if (matchesSearch(file.path)) {
        matchingFileIndices.add(file.index);
      }
    });

    const folderMatchMemo = new Map<string, boolean>();
    const hasMatchingContent = (folderId: string): boolean => {
      if (!normalizedTorrentSearch) return true;
      const memoized = folderMatchMemo.get(folderId);
      if (memoized !== undefined) return memoized;

      const folder = torrentTree.folders.get(folderId);
      if (!folder) return false;

      const selfMatch = matchesSearch(folder.name);
      const hasMatchingFiles = folder.directFileIndices.some((index) =>
        matchingFileIndices.has(index)
      );
      const hasMatchingChildren = folder.childFolderIds.some((childId) =>
        hasMatchingContent(childId)
      );

      const result = selfMatch || hasMatchingFiles || hasMatchingChildren;
      folderMatchMemo.set(folderId, result);
      return result;
    };

    const rows: TorrentTreeRow[] = [];

    const addFolderRows = (folderId: string, depth: number) => {
      const folder = torrentTree.folders.get(folderId);
      if (!folder || !hasMatchingContent(folderId)) return;

      const selectedCount = folderSelectedCountById.get(folderId) ?? 0;
      const expanded = normalizedTorrentSearch
        ? true
        : expandedFolderIds.has(folderId);

      rows.push({
        key: `folder:${folderId}`,
        type: "folder",
        folderId,
        depth,
        name: folder.name,
        totalSize: folder.totalSize,
        selectedCount,
        totalCount: folder.allFileIndices.length,
        expanded,
      });

      if (!expanded) return;

      const sortedChildFolders = [...folder.childFolderIds].sort(
        compareFolderIds
      );
      sortedChildFolders.forEach((childId) =>
        addFolderRows(childId, depth + 1)
      );

      const sortedDirectFiles = [...folder.directFileIndices]
        .filter((index) =>
          normalizedTorrentSearch ? matchingFileIndices.has(index) : true
        )
        .sort(compareFileIndices);

      sortedDirectFiles.forEach((fileIndex) => {
        const file = torrentFilesByIndex.get(fileIndex);
        if (!file) return;

        rows.push({
          key: `file:${fileIndex}`,
          type: "file",
          file,
          depth: depth + 1,
          name: torrentTree.fileNameByIndex.get(fileIndex) ?? file.path,
          selected: selectedTorrentIndices.has(fileIndex),
        });
      });
    };

    [...torrentTree.rootFolderIds]
      .sort(compareFolderIds)
      .forEach((folderId) => {
        addFolderRows(folderId, 0);
      });

    [...torrentTree.rootFileIndices]
      .filter((index) =>
        normalizedTorrentSearch ? matchingFileIndices.has(index) : true
      )
      .sort(compareFileIndices)
      .forEach((fileIndex) => {
        const file = torrentFilesByIndex.get(fileIndex);
        if (!file) return;

        rows.push({
          key: `file:${fileIndex}`,
          type: "file",
          file,
          depth: 0,
          name: torrentTree.fileNameByIndex.get(fileIndex) ?? file.path,
          selected: selectedTorrentIndices.has(fileIndex),
        });
      });

    return rows;
  }, [
    expandedFolderIds,
    folderSelectedCountById,
    normalizedTorrentSearch,
    selectedTorrentIndices,
    torrentFiles,
    torrentFilesByIndex,
    torrentSort,
    torrentTree,
  ]);

  const canOpenTorrentStep =
    visible && selectedDownloader === Downloader.Torrent && !!selectedMagnetUri;

  const shouldShowTorrentFiles = canOpenTorrentStep && showTorrentStepModal;

  const allTorrentFilesSelected =
    torrentFiles.length > 0 &&
    selectedTorrentIndices.size === torrentFiles.length;

  const fetchTorrentFiles = useCallback(async () => {
    if (!selectedMagnetUri) {
      return;
    }

    const cached = torrentFilesCache.current.get(selectedMagnetUri);
    if (cached) {
      setTorrentFiles(cached.files);
      setSelectedTorrentIndices(
        new Set(cached.files.map((file) => file.index))
      );
      setExpandedFolderIds(new Set());
      setTorrentFilesError(null);
      setTorrentFilesLoading(false);
      return;
    }

    setTorrentFilesLoading(true);
    setTorrentFilesError(null);

    let response:
      | { ok: true; data: TorrentFilesResponse }
      | { ok: false; error: string };

    try {
      response = await window.electron.getTorrentFiles(selectedMagnetUri);
    } catch {
      setTorrentFiles([]);
      setSelectedTorrentIndices(new Set());
      setExpandedFolderIds(new Set());
      setTorrentFilesError(DownloadError.TorrentFilesUnavailable);
      setTorrentFilesLoading(false);
      return;
    }

    if (!response.ok) {
      setTorrentFiles([]);
      setSelectedTorrentIndices(new Set());
      setExpandedFolderIds(new Set());
      setTorrentFilesError(
        response.error || DownloadError.TorrentFilesUnavailable
      );
      setTorrentFilesLoading(false);
      return;
    }

    if (torrentFilesCache.current.size >= 20) {
      const oldestKey = torrentFilesCache.current.keys().next().value;
      if (oldestKey) {
        torrentFilesCache.current.delete(oldestKey);
      }
    }

    torrentFilesCache.current.set(selectedMagnetUri, response.data);
    setTorrentFiles(response.data.files);
    setSelectedTorrentIndices(
      new Set(response.data.files.map((file) => file.index))
    );
    setExpandedFolderIds(new Set());
    setTorrentFilesError(null);
    setTorrentFilesLoading(false);
  }, [selectedMagnetUri]);

  useEffect(() => {
    if (!shouldShowTorrentFiles) {
      setTorrentFiles([]);
      setSelectedTorrentIndices(new Set());
      setExpandedFolderIds(new Set());
      setTorrentFilesError(null);
      setTorrentFilesLoading(false);
      setTorrentFileSearch("");
      return;
    }

    fetchTorrentFiles().catch(() => undefined);
  }, [fetchTorrentFiles, shouldShowTorrentFiles]);

  useEffect(() => {
    if (!visible) {
      setShowTorrentStepModal(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!canOpenTorrentStep && showTorrentStepModal) {
      setShowTorrentStepModal(false);
    }
  }, [canOpenTorrentStep, showTorrentStepModal]);

  useEffect(() => {
    if (torrentTree.rootFolderIds.length === 0) {
      setExpandedFolderIds(new Set());
      return;
    }

    setExpandedFolderIds(new Set(torrentTree.rootFolderIds));
  }, [torrentTree.rootFolderIds]);

  const toggleTorrentFile = useCallback(
    (file: TorrentFile) => {
      setSelectedTorrentIndices((current) => {
        const next = new Set(current);
        const isSelected = next.has(file.index);

        if (isSelected) {
          next.delete(file.index);
        } else {
          next.add(file.index);
        }

        return next;
      });
    },
    [setSelectedTorrentIndices]
  );

  const toggleTorrentFolder = useCallback(
    (folderId: string) => {
      const folder = torrentTree.folders.get(folderId);
      if (!folder || folder.allFileIndices.length === 0) return;

      setSelectedTorrentIndices((current) => {
        const next = new Set(current);
        const shouldDeselect = folder.allFileIndices.every((index) =>
          next.has(index)
        );

        folder.allFileIndices.forEach((index) => {
          if (shouldDeselect) {
            next.delete(index);
          } else {
            next.add(index);
          }
        });

        return next;
      });
    },
    [torrentTree.folders]
  );

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const selectAllTorrentFiles = useCallback(() => {
    const allIndices = new Set(torrentFiles.map((file) => file.index));
    setSelectedTorrentIndices(allIndices);
  }, [torrentFiles]);

  const clearTorrentSelection = useCallback(() => {
    setSelectedTorrentIndices(new Set());
  }, []);

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await globalThis.electron.showOpenDialog({
      defaultPath: selectedPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      setSelectedPath(path);
    }
  };

  const getButtonContent = () => {
    if (downloadStarting) {
      return (
        <>
          <SyncIcon className="download-settings-modal__loading-spinner" />
          {t("loading")}
        </>
      );
    }

    if (hasActiveDownload) {
      return (
        <>
          <PlusIcon />
          {t("add_to_queue")}
        </>
      );
    }

    return (
      <>
        <DownloadIcon />
        {t("download_now")}
      </>
    );
  };

  const handleStartClick = async (
    selectedFileIndices?: number[],
    totalSelectedSize?: number
  ) => {
    if (repack) {
      setDownloadStarting(true);

      try {
        const response = await startDownload(
          repack,
          selectedDownloader!,
          selectedPath,
          automaticExtractionEnabled,
          hasActiveDownload,
          selectedFileIndices,
          totalSelectedSize
        );

        if (response.ok) {
          setShowTorrentStepModal(false);
          onClose();
          return;
        } else if (response.error) {
          showErrorToast(t("download_error"), t(response.error), 4_000);
        }
      } catch (error) {
        if (error instanceof Error) {
          showErrorToast(t("download_error"), error.message, 4_000);
        }
      } finally {
        setDownloadStarting(false);
      }
    }
  };

  const handlePrimaryButtonClick = async () => {
    await handleStartClick();
  };

  const handleTorrentStepDownload = async () => {
    const selectedFileIndices = Array.from(selectedTorrentIndices).sort(
      (a, b) => a - b
    );

    await handleStartClick(selectedFileIndices, selectedTorrentSize);
  };

  const handleRetryFetchTorrentFiles = async () => {
    await fetchTorrentFiles();
  };

  const toggleAllTorrentFiles = () => {
    if (allTorrentFilesSelected) {
      clearTorrentSelection();
      return;
    }

    selectAllTorrentFiles();
  };

  const renderFolderRow = (row: FolderTorrentTreeRow) => {
    const isChecked =
      row.totalCount > 0 && row.selectedCount === row.totalCount;
    const isIndeterminate =
      row.selectedCount > 0 && row.selectedCount < row.totalCount;

    return (
      <div
        key={row.key}
        className={`download-settings-modal__torrent-file-row download-settings-modal__torrent-folder-row ${
          isChecked ? "download-settings-modal__torrent-file-row--selected" : ""
        }`}
      >
        <span className="download-settings-modal__torrent-file-name-cell">
          <span
            className="download-settings-modal__torrent-node-content"
            style={{ paddingLeft: `${row.depth * 16}px` }}
          >
            <button
              type="button"
              className="download-settings-modal__torrent-row-trigger"
              onClick={() => toggleFolderExpanded(row.folderId)}
            >
              <span
                className={`download-settings-modal__torrent-folder-chevron ${
                  row.expanded
                    ? "download-settings-modal__torrent-folder-chevron--expanded"
                    : ""
                }`}
              >
                <ChevronDownIcon size={14} />
              </span>
            </button>
            <button
              type="button"
              className={`checkbox-field__checkbox ${
                isChecked || isIndeterminate ? "checked" : ""
              } ${
                isIndeterminate
                  ? "download-settings-modal__folder-checkbox--indeterminate"
                  : ""
              }`}
              onClick={() => toggleTorrentFolder(row.folderId)}
            >
              <span
                className={`checkbox-field__icon ${
                  isChecked && !isIndeterminate ? "checked" : ""
                }`}
              >
                <CheckIcon />
              </span>
            </button>
            <FileDirectoryIcon
              size={14}
              className="download-settings-modal__torrent-node-icon"
            />
            <button
              type="button"
              className="download-settings-modal__torrent-row-trigger download-settings-modal__torrent-row-trigger--label"
              onClick={() => toggleFolderExpanded(row.folderId)}
              title={row.name}
            >
              <span className="download-settings-modal__torrent-file-path download-settings-modal__torrent-file-path--folder">
                {row.name}
              </span>
            </button>
          </span>
        </span>
        <span className="download-settings-modal__torrent-file-size">
          {formatBytes(row.totalSize)}
        </span>
      </div>
    );
  };

  const renderFileRow = (row: FileTorrentTreeRow) => (
    <div
      key={row.key}
      className={`download-settings-modal__torrent-file-row ${
        row.selected
          ? "download-settings-modal__torrent-file-row--selected"
          : ""
      }`}
    >
      <span className="download-settings-modal__torrent-file-name-cell">
        <span
          className="download-settings-modal__torrent-node-content"
          style={{ paddingLeft: `${row.depth * 16}px` }}
        >
          <span className="download-settings-modal__torrent-folder-spacer" />
          <button
            type="button"
            className={`checkbox-field__checkbox ${row.selected ? "checked" : ""}`}
            onClick={() => toggleTorrentFile(row.file)}
          >
            <span
              className={`checkbox-field__icon ${row.selected ? "checked" : ""}`}
            >
              <CheckIcon />
            </span>
          </button>
          <FileIcon
            size={14}
            className="download-settings-modal__torrent-node-icon"
          />
          <button
            type="button"
            className="download-settings-modal__torrent-row-trigger download-settings-modal__torrent-row-trigger--label"
            onClick={() => toggleTorrentFile(row.file)}
            title={row.file.path}
          >
            <span className="download-settings-modal__torrent-file-path">
              {row.name}
            </span>
          </button>
        </span>
      </span>
      <span className="download-settings-modal__torrent-file-size">
        {formatBytes(row.file.length)}
      </span>
    </div>
  );

  const renderTorrentRow = (row: TorrentTreeRow) => {
    if (row.type === "folder") {
      return renderFolderRow(row);
    }

    return renderFileRow(row);
  };

  const torrentRowsMaxHeight = Math.min(
    460,
    Math.max(36, filteredTorrentRows.length * 36)
  );

  let torrentRowsContent: ReactNode;
  if (torrentFilesLoading) {
    torrentRowsContent = (
      <div className="download-settings-modal__torrent-files-feedback">
        {t("loading_torrent_files")}
      </div>
    );
  } else if (torrentFilesError) {
    torrentRowsContent = (
      <div className="download-settings-modal__torrent-files-feedback">
        <span>{t(torrentFilesError)}</span>
        <Button theme="outline" onClick={handleRetryFetchTorrentFiles}>
          {t("retry_fetch_torrent_files")}
        </Button>
      </div>
    );
  } else {
    torrentRowsContent = (
      <div className="download-settings-modal__torrent-files-list">
        <div
          className="download-settings-modal__torrent-files-scroll"
          style={{ maxHeight: `${torrentRowsMaxHeight}px` }}
        >
          {filteredTorrentRows.map(renderTorrentRow)}
        </div>
      </div>
    );
  }

  return (
    <Modal
      visible={visible}
      title={t("download_settings")}
      description={t("space_left_on_disk", {
        space: formatBytes(diskFreeSpace ?? 0),
      })}
      onClose={onClose}
    >
      <div className="download-settings-modal__container">
        <div className="download-settings-modal__downloads-path-field">
          <span>{t("downloader")}</span>

          <div className="download-settings-modal__downloaders-list-wrapper">
            <div className="download-settings-modal__downloaders-list">
              {downloadOptions.map((option, index) => {
                const isSelected = selectedDownloader === option.downloader;
                const tooltipId = `availability-indicator-${option.downloader}`;
                const isLastItem = index === downloadOptions.length - 1;

                const Indicator = option.isAvailable ? motion.span : "span";

                const isDisabled =
                  !option.canHandle ||
                  (!option.isAvailable && !option.isAvailableButNotConfigured);

                const getAvailabilityIndicator = () => {
                  if (option.isAvailable) {
                    return (
                      <Indicator
                        className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--available download-settings-modal__availability-indicator--pulsating`}
                        animate={{
                          scale: [1, 1.1, 1],
                          opacity: [1, 0.7, 1],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                        data-tooltip-id={tooltipId}
                        data-tooltip-content={t("downloader_online")}
                      />
                    );
                  }

                  if (option.isAvailableButNotConfigured) {
                    return (
                      <span
                        className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--warning`}
                        data-tooltip-id={tooltipId}
                        data-tooltip-content={t("downloader_not_configured")}
                      />
                    );
                  }

                  if (option.canHandle) {
                    return (
                      <span
                        className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--unavailable`}
                        data-tooltip-id={tooltipId}
                        data-tooltip-content={t("downloader_offline")}
                      />
                    );
                  }

                  return (
                    <span
                      className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--not-present`}
                      data-tooltip-id={tooltipId}
                      data-tooltip-content={t("downloader_not_available")}
                    />
                  );
                };

                const getRightContent = () => {
                  if (isSelected) {
                    return (
                      <motion.div
                        className="download-settings-modal__check-icon-wrapper"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{
                          type: "spring",
                          stiffness: 300,
                          damping: 20,
                        }}
                      >
                        <CheckCircleFillIcon
                          size={16}
                          className="download-settings-modal__check-icon"
                        />
                      </motion.div>
                    );
                  }

                  if (
                    option.downloader === Downloader.RealDebrid &&
                    option.canHandle
                  ) {
                    return (
                      <div className="download-settings-modal__recommendation-badge">
                        <Badge>{t("recommended")}</Badge>
                      </div>
                    );
                  }

                  return null;
                };

                return (
                  <div
                    key={option.downloader}
                    className="download-settings-modal__downloader-item-wrapper"
                  >
                    <button
                      type="button"
                      className={`download-settings-modal__downloader-item ${
                        isSelected
                          ? "download-settings-modal__downloader-item--selected"
                          : ""
                      } ${
                        isLastItem
                          ? "download-settings-modal__downloader-item--last"
                          : ""
                      }`}
                      disabled={isDisabled}
                      onClick={() => {
                        if (
                          [
                            Downloader.RealDebrid,
                            Downloader.Premiumize,
                            Downloader.AllDebrid,
                          ].includes(option.downloader) &&
                          option.isAvailableButNotConfigured
                        ) {
                          setShowRealDebridModal(true);
                        } else {
                          setSelectedDownloader(option.downloader);
                        }
                      }}
                    >
                      <span className="download-settings-modal__downloader-name">
                        {DOWNLOADER_NAME[option.downloader]}
                      </span>
                      <div className="download-settings-modal__availability-indicator-wrapper">
                        {getAvailabilityIndicator()}
                      </div>
                      <Tooltip id={tooltipId} />
                      {getRightContent()}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {canOpenTorrentStep && (
            <button
              type="button"
              className="download-settings-modal__select-files-link"
              onClick={() => setShowTorrentStepModal(true)}
              disabled={downloadStarting}
            >
              <FileIcon size={12} />
              <span className="download-settings-modal__select-files-link-text">
                {t("select_files_to_download")}
              </span>
            </button>
          )}
        </div>

        <div className="download-settings-modal__downloads-path-field">
          <TextField
            value={selectedPath}
            readOnly
            disabled
            label={t("download_path")}
            error={
              hasWritePermission === false ? (
                <span
                  className="download-settings-modal__path-error"
                  data-open-article="cannot-write-directory"
                >
                  {t("no_write_permission")}
                </span>
              ) : undefined
            }
            rightContent={
              <Button
                className="download-settings-modal__change-path-button"
                theme="outline"
                onClick={handleChooseDownloadsPath}
                disabled={downloadStarting}
              >
                {t("change")}
              </Button>
            }
          />

          <p className="download-settings-modal__hint-text">
            <Trans i18nKey="select_folder_hint" ns="game_details">
              <Link to="/settings" />
            </Trans>
          </p>
        </div>

        <CheckboxField
          label={t("automatically_extract_downloaded_files")}
          checked={automaticExtractionEnabled}
          onChange={() =>
            setAutomaticExtractionEnabled(!automaticExtractionEnabled)
          }
        />

        <Button
          onClick={handlePrimaryButtonClick}
          disabled={
            downloadStarting ||
            selectedDownloader === null ||
            !hasWritePermission ||
            downloadOptions.some(
              (option) =>
                option.downloader === selectedDownloader &&
                (option.isAvailableButNotConfigured ||
                  (!option.isAvailable && option.canHandle) ||
                  !option.canHandle)
            )
          }
        >
          {getButtonContent()}
        </Button>
      </div>

      <RealDebridInfoModal
        visible={showRealDebridModal}
        onClose={() => setShowRealDebridModal(false)}
      />

      <Modal
        visible={showTorrentStepModal}
        title={t("torrent_files")}
        onClose={() => setShowTorrentStepModal(false)}
        large
        noContentPadding
      >
        <div className="download-settings-modal__torrent-step">
          <div className="download-settings-modal__torrent-step-toolbar">
            <TextField
              placeholder={t("search_torrent_files")}
              value={torrentFileSearch}
              onChange={(event) => setTorrentFileSearch(event.target.value)}
              theme="dark"
            />

            <div className="download-settings-modal__torrent-filters">
              <span className="download-settings-modal__torrent-sort-label">
                {t("sort_by", { ns: "library" })}
              </span>
              <SelectField
                className="download-settings-modal__torrent-sort-select"
                theme="dark"
                value={torrentSort.column === "size" ? "size_asc" : "name_asc"}
                onChange={(event) => {
                  setTorrentSort(parseTorrentSortOption(event.target.value));
                }}
                options={[
                  {
                    key: "torrent-name-asc",
                    value: "name_asc",
                    label: t("torrent_name_column"),
                  },
                  {
                    key: "torrent-size-asc",
                    value: "size_asc",
                    label: t("torrent_size_column"),
                  },
                ]}
              />
            </div>
          </div>

          <div className="download-settings-modal__torrent-table">
            <div className="download-settings-modal__torrent-table-head">
              <span>{t("torrent_name_column")}</span>
              <span>{t("torrent_size_column")}</span>
            </div>

            <button
              type="button"
              className="download-settings-modal__torrent-file-row download-settings-modal__torrent-file-row--select-all"
              onClick={toggleAllTorrentFiles}
              disabled={torrentFilesLoading || torrentFiles.length === 0}
            >
              <span className="download-settings-modal__torrent-file-name-cell">
                <div
                  className={`checkbox-field__checkbox ${
                    allTorrentFilesSelected ? "checked" : ""
                  }`}
                >
                  <span
                    className={`checkbox-field__icon ${
                      allTorrentFilesSelected ? "checked" : ""
                    }`}
                  >
                    <CheckIcon />
                  </span>
                </div>
                <span className="download-settings-modal__torrent-file-path download-settings-modal__torrent-file-path--bold">
                  {t("select_all_files")}
                </span>
              </span>
              <span className="download-settings-modal__torrent-file-size">
                {formatBytes(selectedTorrentSize)}
              </span>
            </button>
          </div>

          {torrentRowsContent}

          <div className="download-settings-modal__torrent-files-footer">
            <span className="download-settings-modal__torrent-files-summary">
              {t("selected_files")}: {selectedTorrentIndices.size}/
              {torrentFiles.length}
            </span>
            <Button
              onClick={handleTorrentStepDownload}
              disabled={
                downloadStarting ||
                torrentFilesLoading ||
                !!torrentFilesError ||
                selectedTorrentIndices.size === 0
              }
            >
              {getButtonContent()}
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
