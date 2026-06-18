import { GameRepack } from "@types";
import { formatDate } from "../../../hooks";
import { useMemo } from "react";
import { CalendarDotsIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import type { FocusOverrides } from "../../../services";

import "./styles.scss";
import { FocusItem } from "../focus-item";

interface DownloadSourceOptionProps {
  option: Pick<
    GameRepack,
    "title" | "fileSize" | "downloadSourceName" | "uploadDate"
  >;
  stealFocusOnAppear?: boolean;
  focusNavigationOverrides?: FocusOverrides;
  onSelect: (
    option: Pick<
      GameRepack,
      "title" | "fileSize" | "downloadSourceName" | "uploadDate"
    >
  ) => void;
}

export function DownloadSourceOption({
  option,
  stealFocusOnAppear = false,
  focusNavigationOverrides,
  onSelect,
}: Readonly<DownloadSourceOptionProps>) {
  const formatedDate = useMemo(() => {
    return option.uploadDate ? formatDate(new Date(option.uploadDate)) : "";
  }, [option.uploadDate]);

  return (
    <FocusItem
      asChild
      stealFocusOnAppear={stealFocusOnAppear}
      navigationOverrides={focusNavigationOverrides}
    >
      <button
        className="download-source-option"
        onClick={() => onSelect(option)}
      >
        <div className="download-source-option__header">
          <div className="download-source-option__header__left">
            <p className="download-source-option__header__left__title">
              {option.title}
            </p>
            <p className="download-source-option__header__left__download-source-name">
              {option.downloadSourceName}
            </p>
          </div>

          <div className="download-source-option__header__right">
            <div className="download-source-option__header__right__file-size">
              <DownloadSimpleIcon size={16.5} />
              <p>{option.fileSize}</p>
            </div>
            <div className="download-source-option__header__right__upload-date">
              <CalendarDotsIcon size={16} />
              <p>{formatedDate}</p>
            </div>
          </div>
        </div>

        {/* Footer placeholders intentionally hidden for this release. */}
        {/*
          <div className="download-source-option__divider" />

          <div className="download-source-option__footer">
            <div className="download-source-option__footer__left">
              todo cache status
            </div>
            <div className="download-source-option__footer__right">
              todo seeders count
            </div>
          </div>
        */}
      </button>
    </FocusItem>
  );
}
