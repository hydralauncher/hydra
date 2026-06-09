import Ps1Logo from "@renderer/assets/ps1-logo.svg?react";
import Ps2Logo from "@renderer/assets/ps2-logo.svg?react";
import Ps3Logo from "@renderer/assets/ps3-logo.svg?react";

import "./platform-title.scss";

interface PlatformTitleProps {
  system: "ps1" | "ps2" | "ps3";
  prefix?: string;
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
