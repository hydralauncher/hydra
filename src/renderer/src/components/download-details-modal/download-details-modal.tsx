import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button } from "@renderer/components";
import type { DownloadProgress, TrackerInfo } from "@types";
import "./download-details-modal.scss";

interface DownloadDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  progress: DownloadProgress | null;
}

export function DownloadDetailsModal({
  visible,
  onClose,
  progress,
}: DownloadDetailsModalProps) {
  const { t } = useTranslation("downloads");
  const [activeTab, setActiveTab] = useState<"trackers" | "stats">("trackers");

  const trackerStats = useMemo(() => {
    if (!progress?.trackerStats) return null;
    return progress.trackerStats;
  }, [progress]);

  const trackers = useMemo(() => {
    if (!progress?.trackers) return [];
    return progress.trackers;
  }, [progress]);

  const stats = useMemo(() => {
    if (!progress) return null;
    if (progress.stats) return progress.stats;

    const totalDownloaded = progress.download?.bytesDownloaded ?? 0;
    const totalUploaded = (progress as any).totalUploaded ?? 0;
    const fileSize =
      progress.download?.fileSize ?? progress.download?.selectedFilesSize ?? 0;
    const bytesRemaining = Math.max(0, (fileSize || 0) - totalDownloaded);
    const uploadSpeed = (progress as any).uploadSpeed ?? 0;

    const ratio = totalDownloaded > 0 ? totalUploaded / totalDownloaded : 0;

    return {
      uploadSpeed,
      totalDownloaded,
      totalUploaded,
      ratio,
      bytesRemaining,
    } as unknown as typeof progress.stats;
  }, [progress]);

  if (!progress) return null;

  const formatBytes = (bytes: number): string => {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  const getTrackerStatusColor = (status: TrackerInfo["status"]): string => {
    switch (status) {
      case "working":
        return "tracker-status--working";
      case "updating":
        return "tracker-status--updating";
      case "failed":
        return "tracker-status--failed";
      case "not_contacted":
        return "tracker-status--not-contacted";
      default:
        return "tracker-status--unknown";
    }
  };

  return (
    <Modal visible={visible} onClose={onClose} title={t("download_details")}>
      <div className="download-details-modal">
        <div className="tabs">
          <button
            className={`tab ${activeTab === "trackers" ? "active" : ""}`}
            onClick={() => setActiveTab("trackers")}
          >
            {t("trackers")}
          </button>
          <button
            className={`tab ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            {t("statistics")}
          </button>
        </div>

        {activeTab === "trackers" && (
          <div className="tab-content">
            {trackerStats && (
              <div className="tracker-summary">
                <div className="summary-item">
                  <span className="label">{t("working_trackers")}:</span>
                  <span className="value">
                    {trackerStats.workingTrackers}/{trackerStats.totalTrackers}
                  </span>
                </div>
              </div>
            )}

            <div className="tracker-list">
              {trackers.length > 0 ? (
                trackers.map((tracker, index) => (
                  <div key={index} className="tracker-item">
                    <div className="tracker-header">
                      <div
                        className={`tracker-status-dot ${getTrackerStatusColor(tracker.status)}`}
                      />
                      <span className="tracker-url">{tracker.url}</span>
                      <span className="tracker-status">
                        {t(`tracker_status_${tracker.status}`)}
                      </span>
                    </div>
                    <div className="tracker-stats">
                      <div className="stat">
                        <span className="label">{t("fails")}:</span>
                        <span className="value">{tracker.fails || 0}</span>
                      </div>
                      <div className="stat">
                        <span className="label">{t("updating")}:</span>
                        <span className="value">
                          {tracker.updating ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-message">{t("no_trackers")}</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="tab-content stats-content">
            {stats ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">{t("download_speed")}</span>
                  <span className="stat-value">
                    {formatSpeed(
                      (stats && (stats as any).downloadSpeed) ??
                        progress.downloadSpeed ??
                        0
                    )}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">{t("upload_speed")}</span>
                  <span className="stat-value">
                    {formatSpeed(stats.uploadSpeed)}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">{t("total_downloaded")}</span>
                  <span className="stat-value">
                    {formatBytes(stats.totalDownloaded)}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">{t("total_uploaded")}</span>
                  <span className="stat-value">
                    {formatBytes(stats.totalUploaded)}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">{t("upload_ratio")}</span>
                  <span className="stat-value">{stats.ratio.toFixed(2)}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">{t("bytes_remaining")}</span>
                  <span className="stat-value">
                    {formatBytes(stats.bytesRemaining)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="empty-message">{t("no_statistics")}</p>
            )}
          </div>
        )}

        <div className="modal-footer">
          <Button onClick={onClose}>{t("close")}</Button>
        </div>
      </div>
    </Modal>
  );
}
