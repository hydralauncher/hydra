import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@renderer/hooks";
import {
  Typography,
  VerticalFocusGroup,
  ScrollArea,
  Divider,
} from "../../components";
import { useHeaderTitle } from "../../hooks";
import { CrackCalendarGame } from "@types";

import "./styles.scss";

export default function ReleaseCalendarDetail() {
  const { slug } = useParams();
  const { t } = useTranslation();
  const [game, setGame] = useState<CrackCalendarGame | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const monthCache = useAppSelector((state) => state.crackCalendar.monthCache);

  useEffect(() => {
    const cachedGame = Object.values(monthCache)
      .flatMap((month) => month.games)
      .find((g) => g.slug === slug);

    if (cachedGame) {
      setGame(cachedGame);
      setIsLoading(false);
    } else {
      window.electron.getCrackCalendarGame(slug!).then((res) => {
        setGame(res);
        setIsLoading(false);
      });
    }
  }, [slug, monthCache]);

  useHeaderTitle(game?.title || t("sidebar.release_calendar"));

  if (isLoading) {
    return (
      <section className="release-calendar-detail">
        <Typography variant="body" className="status-message">Loading...</Typography>
      </section>
    );
  }

  if (!game) {
    return (
      <section className="release-calendar-detail">
        <Typography variant="body" className="status-message">Game not found</Typography>
      </section>
    );
  }

  return (
    <VerticalFocusGroup regionId="release-calendar-detail" asChild>
      <section className="release-calendar-detail">
        <ScrollArea className="detail-scroll-area">
          <div className="detail-container">
            <div className="hero-section">
               <div className="cover-wrapper">
                 <img src={game.image || ""} alt={game.title} className="cover-image" />
               </div>
               <div className="info-panel">
                 <Typography variant="h1">{game.title}</Typography>
                 <div className="status-badges">
                   <div className={`badge ${game.crackStatus === "CRACKED" ? "cracked" : "not-cracked"}`}>
                     {game.crackStatus}
                   </div>
                   {game.countdown !== "Released" && (
                     <div className="badge upcoming">
                       {game.countdown}
                     </div>
                   )}
                 </div>
                 {game.statusNote && (
                   <Typography variant="body" className="status-note">
                     {game.statusNote}
                   </Typography>
                 )}

                 <Divider />

                 <div className="details-grid">
                   <div className="detail-row">
                     <Typography variant="label">Release Date</Typography>
                     <Typography variant="body">{game.releaseDate}</Typography>
                   </div>
                   <div className="detail-row">
                     <Typography variant="label">Crack Date</Typography>
                     <Typography variant="body">{game.crackDate || "N/A"}</Typography>
                   </div>
                   <div className="detail-row">
                     <Typography variant="label">DRM Protection</Typography>
                     <Typography variant="body">{game.drmProtection || "None"}</Typography>
                   </div>
                   <div className="detail-row">
                     <Typography variant="label">Scene Group</Typography>
                     <Typography variant="body">{game.sceneGroup || "Unknown"}</Typography>
                   </div>
                 </div>
               </div>
            </div>

            <div className="description-section">
               <Typography variant="h3">Description</Typography>
               <Typography variant="body" className="description">
                 {game.description}
               </Typography>
            </div>
          </div>
        </ScrollArea>
      </section>
    </VerticalFocusGroup>
  );
}
