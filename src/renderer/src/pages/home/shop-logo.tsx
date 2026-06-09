/* Per-platform logo picker for the home cards. Reads the game's
   shop + classics platform and returns the appropriate SVG-as-React
   component. Each card component imports this and renders it where
   the hardcoded SteamLogo used to live, so PS1/PS2/PS3 games get
   their own console badge instead of the wrong Steam mark.

   The logos all use `fill="currentColor"` so they inherit the card's
   muted text color from CSS — same tint behavior as the previous
   Steam-only icon. Sizing is controlled by the className the caller
   passes (`__shop-icon`), not by intrinsic dimensions. */

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
  /* Classics games carry a platform string ("Sony Playstation",
     "Sony Playstation 2", etc.). Convert it to a system code via the
     shared platformToSystem helper so the regex matching stays in
     one place. PC games (steam shop) just get the Steam logo.

     A `--{system}` modifier is appended to the className so SCSS
     can bump the PS2/PS3 marks individually — their glyph weight
     reads optically smaller than the Steam wordmark and the PS1
     "PS" mark at the same nominal size, so we scale those two up
     a touch in CSS to balance the row visually. */
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
        /* Unknown classics platform — fall back to Steam logo as a
           neutral placeholder. Unlikely in practice since launchbox
           data always tags PS1/2/3. */
        return <SteamLogo className={className} />;
    }
  }
  return <SteamLogo className={className} />;
}
