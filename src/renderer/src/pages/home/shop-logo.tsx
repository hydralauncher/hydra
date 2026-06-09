import type { HomeRowGame } from "./home-game-card";
import { platformToSystem } from "@renderer/helpers";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import Ps1Logo from "@renderer/assets/ps1-logo.svg?react";
import Ps2Logo from "@renderer/assets/ps2-logo.svg?react";
import Ps3Logo from "@renderer/assets/ps3-logo.svg?react";

interface ShopLogoProps {
  game: Pick<HomeRowGame, "shop" | "platform">;
  className?: string;
}

export function ShopLogo({ game, className }: ShopLogoProps) {
  const join = (extra: string) => (className ? `${className} ${extra}` : extra);

  if (game.shop === "launchbox") {
    const system = platformToSystem(game.platform);
    switch (system) {
      case "ps1":
        return <Ps1Logo className={join("home-shop-logo--ps1")} />;
      case "ps2":
        return <Ps2Logo className={join("home-shop-logo--ps2")} />;
      case "ps3":
        return <Ps3Logo className={join("home-shop-logo--ps3")} />;
      default:
        return <SteamLogo className={className} />;
    }
  }
  return <SteamLogo className={className} />;
}
