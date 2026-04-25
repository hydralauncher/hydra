import {
  HeartIcon,
  PlayIcon,
  PlusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { motion } from "framer-motion";
import {
  Button,
  Divider,
  HorizontalFocusGroup,
  Tooltip,
  Typography,
} from "../../../common";

export interface HeroProps {
  shopDetails: ShopDetailsWithAssets;
  game: LibraryGame | null;
  isGameRunning: boolean;
  isFavorite: boolean;
  toggleFavorite: () => void;
  onPlay: () => void;
  onClose: () => void;
}

export function Hero({
  shopDetails,
  game,
  isGameRunning,
  isFavorite,
  toggleFavorite,
  onPlay,
  onClose,
}: Readonly<HeroProps>) {
  const renderActionButton = () => {
    if (isGameRunning) {
      return (
        <Button
          variant="primary"
          icon={<XCircleIcon size={24} />}
          onClick={onClose}
        >
          Close Game
        </Button>
      );
    }

    if (game?.executablePath) {
      return (
        <Button
          variant="tertiary"
          iconPosition="right"
          icon={<PlayIcon size={24} weight="fill" />}
          onClick={onPlay}
        >
          Launch Game
        </Button>
      );
    }

    if (game) {
      return (
        <Button
          variant="tertiary"
          iconPosition="right"
          icon={<PlayIcon size={24} weight="fill" />}
          onClick={onPlay}
          disabled={true}
        >
          Launch Game
        </Button>
      );
    }

    return (
      <Button variant="secondary" icon={<PlusCircleIcon size={24} />}>
        Add to Library
      </Button>
    );
  };

  return (
    <section style={{ position: "relative", height: 620, overflow: "hidden" }}>
      <motion.div
        initial={{ scale: 1, x: 0, y: 0 }}
        animate={{
          scale: 1.1,
          x: -10,
          y: -10,
        }}
        transition={{
          duration: 20,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "mirror",
        }}
        className="game-page__hero"
        style={{
          backgroundImage: `url(${shopDetails.assets?.libraryHeroImageUrl})`,
        }}
      />

      <div className="game-page__hero-overlay">
        <img
          src={shopDetails.assets?.logoImageUrl || ""}
          style={{ width: 337 }}
          alt={shopDetails.assets?.title || ""}
        />

        <Typography
          style={{ maxWidth: 512, color: "rgba(255, 255, 255, 0.8)" }}
          dangerouslySetInnerHTML={{
            __html: shopDetails.short_description || "",
          }}
        />

        <HorizontalFocusGroup regionId="hero-actions" asChild>
          <div className="game-page__hero-actions">
            {renderActionButton()}

            <Divider orientation="vertical" />

            <Tooltip
              content={
                isFavorite ? "Remove from Favorites" : "Add to Favorites"
              }
            >
              <Button variant="secondary" onClick={() => toggleFavorite()}>
                <motion.span
                  key={isFavorite ? "filled" : "empty"}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {isFavorite ? (
                    <HeartIcon size={24} weight="fill" />
                  ) : (
                    <HeartIcon size={24} />
                  )}
                </motion.span>
              </Button>
            </Tooltip>
          </div>
        </HorizontalFocusGroup>
      </div>
    </section>
  );
}
