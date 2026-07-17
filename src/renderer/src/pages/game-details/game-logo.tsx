import type { Game, ShopDetailsWithAssets } from "@types";

interface GameLogoProps {
  game: Game | null;
  shopDetails: ShopDetailsWithAssets | null;
}

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  return customUrl || originalUrl || fallbackUrl || "";
};

export function GameLogo({ game, shopDetails }: Readonly<GameLogoProps>) {
  const isCustomGame = game?.shop === "custom";

  const logoImage = isCustomGame
    ? game?.logoImageUrl || ""
    : getImageWithCustomPriority(
        game?.customLogoImageUrl,
        shopDetails?.assets?.logoImageUrl
      );

  if (isCustomGame) {
    // For custom games, show logo image if available, otherwise show game title as text
    if (logoImage) {
      return (
        <img
          src={logoImage}
          className="game-details__game-logo"
          alt={game?.title}
        />
      );
    } else {
      return <div className="game-details__game-logo-text">{game?.title}</div>;
    }
  } else {
    // For non-custom games, show logo image if available
    return logoImage ? (
      <img
        src={logoImage}
        className="game-details__game-logo"
        alt={game?.title}
      />
    ) : null;
  }
}
