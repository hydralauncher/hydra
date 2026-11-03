import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { orderBy } from "lodash-es";
import type { GameRepack } from "@types";
import { getDownloadersForUri, getRepackUriParts } from "@shared";

import { Button } from "@renderer/components/button/button";
import { TextField } from "@renderer/components/text-field/text-field";
import { gameDetailsContext } from "@renderer/context";
import {
  useAppSelector,
  useDate,
  useDownload,
  useToast,
} from "@renderer/hooks";
import {
  getDefaultDownloader,
  useDownloadOptions,
} from "../game-details/modals/use-download-options";
import "../game-details/modals/repacks-modal.scss";

interface RomSourceListProps {
  objectId: string;
  gameTitle: string;
  downloadPath: string;
  onStarted: () => void;
}

function RomSourceRow({
  repack,
  objectId,
  gameTitle,
  downloadPath,
  onStarted,
}: Readonly<RomSourceListProps & { repack: GameRepack }>) {
  const { t } = useTranslation("recompilation");
  const { formatDate } = useDate();
  const { startDownload } = useDownload();
  const { showErrorToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const downloadOptions = useDownloadOptions(repack);
  const [isStarting, setIsStarting] = useState(false);

  // No download settings step: the downloader the settings would pick by
  // default, always extracted, into the folder chosen above the list.
  const start = async () => {
    const downloader = getDefaultDownloader(
      downloadOptions
        .filter((option) => option.isAvailable)
        .map((option) => option.downloader)
    );
    const uri =
      downloader === null
        ? undefined
        : repack.uris.find((candidate) =>
            getDownloadersForUri(candidate).includes(downloader)
          );
    if (downloader === null || !uri) {
      showErrorToast(t("rom_download_unavailable"));
      return;
    }

    setIsStarting(true);
    const response = await startDownload({
      objectId,
      title: gameTitle,
      downloader,
      shop: "launchbox",
      downloadPath,
      uri,
      parts: getRepackUriParts(repack, uri),
      automaticallyExtract: true,
      automaticallyDeleteArchiveFiles:
        userPreferences?.deleteArchiveFilesAfterExtractionByDefault ?? true,
      fileSize: repack.fileSize,
    });
    setIsStarting(false);

    if (response.ok) {
      onStarted();
    } else {
      showErrorToast(t("rom_download_failed"));
    }
  };

  return (
    <Button
      theme="dark"
      className="repacks-modal__repack-button"
      onClick={start}
      disabled={!downloadPath || isStarting}
    >
      <p className="repacks-modal__repack-title">{repack.title}</p>
      <p className="repacks-modal__repack-info">
        {repack.fileSize} - {repack.downloadSourceName} -{" "}
        {repack.uploadDate ? formatDate(repack.uploadDate) : ""}
      </p>
    </Button>
  );
}

/**
 * The base game's download options, in the install modal itself. Same rows
 * as the game page's "Download options", without its settings step.
 */
export function RomSourceList(props: Readonly<RomSourceListProps>) {
  const { t } = useTranslation("recompilation");
  const { repacks, isLoading } = useContext(gameDetailsContext);
  const [filter, setFilter] = useState("");

  const visibleRepacks = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return orderBy(repacks, [(repack) => repack.uploadDate], ["desc"]).filter(
      (repack) =>
        !term ||
        repack.title.toLowerCase().includes(term) ||
        repack.downloadSourceName.toLowerCase().includes(term)
    );
  }, [repacks, filter]);

  if (!isLoading && repacks.length === 0) {
    return <p className="rom-source-list__empty">{t("rom_no_sources")}</p>;
  }

  return (
    <div className="rom-source-list">
      <TextField
        placeholder={t("rom_filter_sources")}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="repacks-modal__repacks">
        {visibleRepacks.map((repack) => (
          <RomSourceRow key={repack.id} repack={repack} {...props} />
        ))}
      </div>
    </div>
  );
}
