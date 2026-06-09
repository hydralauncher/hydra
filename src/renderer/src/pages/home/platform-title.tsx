/* Row title decoration that renders a console logo + label, used for
   the PS1/PS2/PS3 home rows. The SVG components inherit text color
   via `fill="currentColor"` so the logo tints to whatever color the
   row header text uses (muted gray), matching the look of the rest
   of the row chrome instead of a saturated brand color. */

import Ps1Logo from "@renderer/assets/ps1-logo.svg?react";
import Ps2Logo from "@renderer/assets/ps2-logo.svg?react";
import Ps3Logo from "@renderer/assets/ps3-logo.svg?react";

import "./platform-title.scss";

interface PlatformTitleProps {
  system: "ps1" | "ps2" | "ps3";
  /** Text rendered BEFORE the logo. Use for the "Popular [logo]
   *  Games" pattern — `prefix="Popular"`. Omit for the "[logo] RPG
   *  Classics" pattern where the logo opens the title. */
  prefix?: string;
  /** Text rendered AFTER the logo. Required — the logo is never
   *  the last element on the row title (the suffix gives the row
   *  its theme: "Games", "RPG Classics", etc). */
  label: string;
}

const LogoFor = ({ system }: { system: "ps1" | "ps2" | "ps3" }) => {
  const cls = "platform-title__logo";
  switch (system) {
    case "ps1":
      return <Ps1Logo className={cls} />;
    case "ps2":
      return <Ps2Logo className={cls} />;
    case "ps3":
      return <Ps3Logo className={cls} />;
  }
};

export function PlatformTitle({ system, prefix, label }: PlatformTitleProps) {
  /* Each PS SVG has a wildly different native aspect ratio (PS1 is
     near-square, PS2 is ~5.7:1, PS3 is ~4.3:1). Render every logo
     inside a fixed-size box so the row title's horizontal rhythm
     stays consistent — the SVG scales to fit (preserving its own
     aspect) without forcing the heading to jump around between
     rows. The container's data attribute lets per-system tweaks be
     made in CSS if any single logo ends up needing a special case.

     Layout is `[prefix] [logo] [label]` so a row can read as either
     "Popular [logo] Games" (prefix + suffix) or "[logo] RPG
     Classics" (suffix only) without needing two components. */
  return (
    <span className="platform-title">
      {prefix && <span className="platform-title__text">{prefix}</span>}
      <span className="platform-title__logo-box" data-system={system}>
        <LogoFor system={system} />
      </span>
      <span className="platform-title__text">{label}</span>
    </span>
  );
}
