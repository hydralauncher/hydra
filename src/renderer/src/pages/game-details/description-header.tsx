import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { ShareAndroidIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import type { ShopDetails } from "@types";

import * as styles from "./game-details.css";

const OPEN_HYDRA_URL = "https://open.hydralauncher.site";

export interface DescriptionHeaderProps {
  gameDetails: ShopDetails | null;
}

export function DescriptionHeader({ gameDetails }: DescriptionHeaderProps) {
  const [clipboardLock, setClipboardLock] = useState(false);
  const { t, i18n } = useTranslation("game_details");

  const { objectID, shop } = useParams();

  useEffect(() => {
    if (!gameDetails) return setClipboardLock(true);
    setClipboardLock(false);
  }, [gameDetails]);

  const handleCopyToClipboard = () => {
    setClipboardLock(true);

    const searchParams = new URLSearchParams({
      p: btoa(
        JSON.stringify([
          objectID,
          shop,
          encodeURIComponent(gameDetails?.name),
          i18n.language,
        ])
      ),
    });

    navigator.clipboard.writeText(
      OPEN_HYDRA_URL + `/?${searchParams.toString()}`
    );

    const zero = performance.now();

    requestAnimationFrame(function holdLock(time) {
      if (time - zero <= 3000) {
        requestAnimationFrame(holdLock);
      } else {
        setClipboardLock(false);
      }
    });
  };

  return (
    <div className={styles.descriptionHeader}>
      <section className={styles.descriptionHeaderInfo}>
        <p>
          {t("release_date", {
            date: gameDetails?.release_date.date,
          })}
        </p>
        <p>{t("publisher", { publisher: gameDetails?.publishers[0] })}</p>
      </section>

      <Button
        theme="outline"
        onClick={handleCopyToClipboard}
        disabled={clipboardLock || !gameDetails}
      >
        {clipboardLock ? (
          t("copied_link_to_clipboard")
        ) : (
          <>
            <ShareAndroidIcon />
            {t("copy_link_to_clipboard")}
          </>
        )}
      </Button>
    </div>
  );
}
