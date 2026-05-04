import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRightIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@shared";
import { torrentPanelVariants, chevronVariants } from "./download-animations";
import type { LibtorrentFile } from "@types";

interface TorrentFilesPanelProps {
  files: LibtorrentFile[];
}

export function TorrentFilesPanel({ files }: Readonly<TorrentFilesPanelProps>) {
  const { t } = useTranslation("downloads");
  const [isExpanded, setIsExpanded] = useState(false);

  const togglePanel = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className="download-group__torrent-panel">
      <button
        type="button"
        className="download-group__torrent-toggle"
        onClick={togglePanel}
      >
        <motion.div
          variants={chevronVariants}
          animate={isExpanded ? "expanded" : "collapsed"}
          style={{ display: "flex" }}
        >
          <ChevronRightIcon size={14} />
        </motion.div>
        {t("torrent_files")}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="torrent-files-panel"
            variants={torrentPanelVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
          >
            <div className="download-group__torrent-files-list">
              {files.map((file) => {
                const progress =
                  file.size > 0 ? file.bytesDownloaded / file.size : 0;

                return (
                  <div
                    key={file.path}
                    className="download-group__torrent-file-item"
                  >
                    <div className="download-group__torrent-file-info">
                      <span
                        className="download-group__torrent-file-name"
                        title={file.path}
                      >
                        {file.name}
                      </span>
                      <span className="download-group__torrent-file-size">
                        {formatBytes(file.bytesDownloaded)} /{" "}
                        {formatBytes(file.size)}
                      </span>
                    </div>
                    <div className="download-group__progress-bar download-group__progress-bar--small">
                      <div
                        className="download-group__progress-fill"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
