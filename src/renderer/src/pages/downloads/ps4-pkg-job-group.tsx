import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { XCircleIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useAppSelector, useLibrary } from "@renderer/hooks";

import "./download-group.scss";

/**
 * The PS4 PKG being extracted or applied, shown like a download that is
 * extracting. It is not a download: it is not stored and has nothing to
 * remove, it only goes away when the job ends.
 */
export function Ps4PkgJobGroup() {
  const { t } = useTranslation("downloads");
  const { t: tGameDetails } = useTranslation("game_details");
  const navigate = useNavigate();
  const job = useAppSelector((state) => state.ps4PkgJob.job);
  const { library } = useLibrary();
  const [cancelledJob, setCancelledJob] = useState<string | null>(null);

  if (!job) return null;

  const jobKey = `${job.shop}:${job.objectId}:${job.mode}`;
  const game = library.find(
    (entry) => entry.shop === job.shop && entry.objectId === job.objectId
  );
  const title = game?.title ?? job.title;
  const progress = Math.max(0, Math.min(1, job.progress));
  const percent = Math.round(progress * 100);
  const openGame = () => game && navigate(buildGameDetailsPath(game));

  const status =
    job.mode === "update" && job.currentVersion && job.version
      ? tGameDetails("ps4_update_versions", {
          from: job.currentVersion,
          to: job.version,
        })
      : t("extracting");

  const cancel = () => {
    setCancelledJob(jobKey);
    void window.electron.cancelPs4PkgJob();
  };

  return (
    <div className="download-group">
      <div className="download-group__header">
        <div className="download-group__header-title-group">
          <h2>{tGameDetails("extracting")}</h2>
          <h3 className="download-group__header-count">1</h3>
        </div>
      </div>

      <ul className="download-group__simple-list">
        <li className="download-group__simple-card">
          <button
            type="button"
            onClick={openGame}
            className="download-group__simple-thumbnail"
          >
            <img
              src={game?.customCoverImageUrl || game?.libraryImageUrl || ""}
              alt={title}
            />
          </button>

          <div className="download-group__simple-info">
            <button
              type="button"
              onClick={openGame}
              className="download-group__simple-title-button"
            >
              <h3 className="download-group__simple-title">{title}</h3>
            </button>
            <div className="download-group__simple-meta">
              <div className="download-group__simple-meta-row">
                <span className="download-group__simple-extracting">
                  {status}
                </span>
              </div>
            </div>
          </div>

          <div className="download-group__simple-progress">
            <span className="download-group__simple-progress-text">
              {percent}%
            </span>
            <div className="download-group__progress-bar download-group__progress-bar--small">
              <div
                className="download-group__progress-fill"
                style={{ width: `${percent}%`, backgroundColor: "#fff" }}
              />
            </div>
          </div>

          <div className="download-group__simple-actions">
            <Button
              theme="outline"
              onClick={cancel}
              disabled={cancelledJob === jobKey}
              className="download-group__simple-action-btn"
            >
              <XCircleIcon size={16} />
              {t("cancel")}
            </Button>
          </div>
        </li>
      </ul>
    </div>
  );
}
