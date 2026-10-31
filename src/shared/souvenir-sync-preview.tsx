import { useState } from "react";
import {
  DeviceDesktopIcon,
  ImageIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import type { AchievementSouvenirSyncItem } from "@types";
import { useTranslation } from "react-i18next";
import { getSouvenirSyncErrorTranslationKeys } from "./souvenir-sync";
import "./souvenir-sync-preview.scss";

function PreviewImage({
  src,
  alt = "",
  className,
  fallback,
}: Readonly<{
  src?: string | null;
  alt?: string;
  className: string;
  fallback: React.ReactNode;
}>) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <div className={className}>
      {src && src !== failedSrc ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        fallback
      )}
    </div>
  );
}

export function SouvenirSyncPreview({
  item,
}: Readonly<{ item: AchievementSouvenirSyncItem }>) {
  const { t } = useTranslation("settings");
  const title = item.gameTitle ?? t("souvenir_sync_unknown_game");
  const achievements =
    item.achievements ??
    item.achievementNames.map((name) => ({
      name,
      displayName: name,
      iconUrl: null,
    }));
  const errorKey = getSouvenirSyncErrorTranslationKeys(
    item.lastErrorCode ? [item.lastErrorCode] : []
  )[0];

  return (
    <div className="souvenir-sync-preview">
      <PreviewImage
        src={`local:${item.screenshotPath}`}
        alt={t("souvenir_sync_screenshot", { game: title })}
        className="souvenir-sync-preview__screenshot"
        fallback={
          <>
            <ImageIcon size={28} />
            <span>{t("souvenir_sync_screenshot_unavailable")}</span>
          </>
        }
      />
      <div className="souvenir-sync-preview__details">
        <div className="souvenir-sync-preview__game">
          <PreviewImage
            src={item.gameIconUrl}
            className="souvenir-sync-preview__game-icon"
            fallback={<DeviceDesktopIcon size={20} />}
          />
          <strong title={title}>{title}</strong>
        </div>
        <ul className="souvenir-sync-preview__achievements">
          {achievements.map((achievement) => (
            <li key={achievement.name}>
              <PreviewImage
                src={achievement.iconUrl}
                className="souvenir-sync-preview__achievement-icon"
                fallback={<TrophyIcon size={16} />}
              />
              <span>{achievement.displayName}</span>
            </li>
          ))}
        </ul>
        {errorKey ? (
          <p className="souvenir-sync-preview__error">{t(errorKey)}</p>
        ) : null}
      </div>
    </div>
  );
}
