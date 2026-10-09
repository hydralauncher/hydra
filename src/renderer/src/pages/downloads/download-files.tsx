import type { DownloadFile } from "@types";
import { formatBytes } from "@shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./download-files.scss";

export function DownloadFiles({
  files,
  defaultExpanded = false,
}: Readonly<{ files?: DownloadFile[]; defaultExpanded?: boolean }>) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { t } = useTranslation("downloads");
  if (!files?.length) return null;
  return (
    <details
      className="download-files"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{t("download_files", { count: files.length })}</summary>
      {expanded && (
        <ul className="download-files__list">
          {files.map((file) => {
            const percentage = file.completed
              ? 100
              : file.size > 0
                ? Math.min(
                    99,
                    Math.floor((file.bytesDownloaded / file.size) * 100)
                  )
                : 0;
            return (
              <li key={file.index} className="download-files__file">
                <span className="download-files__path" title={file.path}>
                  {file.path}
                </span>
                <span className="download-files__size">
                  {formatBytes(file.bytesDownloaded)} / {formatBytes(file.size)}
                </span>
                <span className="download-files__percentage">
                  {percentage}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
