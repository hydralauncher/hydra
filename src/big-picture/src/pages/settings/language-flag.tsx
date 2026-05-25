import { GlobeHemisphereWestIcon } from "@phosphor-icons/react";
import type { SVGProps } from "react";
import * as FlagIcons from "country-flag-icons/react/3x2";

interface LanguageFlagProps {
  countryCode: string | null;
  className?: string;
}

type FlagComponent = (props: SVGProps<SVGSVGElement>) => JSX.Element;

const flagIconMap = FlagIcons as Record<string, FlagComponent>;

export function LanguageFlag({
  countryCode,
  className,
}: Readonly<LanguageFlagProps>) {
  const normalizedCountryCode = countryCode?.toUpperCase() ?? null;
  const FlagIcon =
    normalizedCountryCode && normalizedCountryCode in flagIconMap
      ? flagIconMap[normalizedCountryCode]
      : null;

  if (!FlagIcon) {
    return <GlobeHemisphereWestIcon size={18} aria-hidden="true" />;
  }

  return (
    <FlagIcon
      className={className}
      aria-hidden="true"
      focusable="false"
      role="img"
    />
  );
}
