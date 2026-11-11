import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppSelector, useLibrary } from "@renderer/hooks";
import type { LibraryGame } from "@types";

import { HeroDownloadView, pickChartColor } from "./download-group";

const noop = () => {};

/**
 * The PS4 PKG being extracted or applied, shown with the same card as a
 * download that is extracting. It is not stored as a download.
 */
export function Ps4PkgJobGroup() {
  const { t } = useTranslation("downloads");
  const job = useAppSelector((state) => state.ps4PkgJob.job);
  const { library } = useLibrary();
  const [cancelledJob, setCancelledJob] = useState<string | null>(null);
  const hasJob = job !== null;

  // A retry of the same game is a new job, so its Cancel starts enabled.
  useEffect(() => {
    if (!hasJob) setCancelledJob(null);
  }, [hasJob]);

  if (!job) return null;

  const jobKey = `${job.shop}:${job.objectId}:${job.mode}`;
  const game =
    library.find(
      (entry) => entry.shop === job.shop && entry.objectId === job.objectId
    ) ??
    ({
      id: `${job.shop}:${job.objectId}`,
      shop: job.shop,
      objectId: job.objectId,
      title: job.title,
    } as LibraryGame);

  const cancel = () => {
    setCancelledJob(jobKey);
    void window.electron.cancelPs4PkgJob();
  };

  return (
    <HeroDownloadView
      game={game}
      isGameDownloading={false}
      isGameExtracting
      downloadSpeed={0}
      finalDownloadSize=""
      peakSpeed={0}
      currentProgress={Math.max(0, Math.min(1, job.progress))}
      dominantColor={pickChartColor()}
      lastPacket={null}
      speedHistory={[]}
      formatSpeed={() => ""}
      calculateETA={() => null}
      pauseDownload={noop}
      resumeDownload={noop}
      onCancelClick={noop}
      onExtractionCancel={cancel}
      isExtractionCancelling={cancelledJob === jobKey}
      t={t}
    />
  );
}
