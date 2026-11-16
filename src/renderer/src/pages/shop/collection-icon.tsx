import { createElement, useState } from "react";
import * as Octicons from "@primer/octicons-react";
import { AppsIcon, type Icon } from "@primer/octicons-react";
import cn from "classnames";

const icons = Octicons as unknown as Record<string, Icon | undefined>;

// The partners panel stores Octicon names in kebab case ("device-desktop" → DeviceDesktopIcon).
const toExportName = (name: string) =>
  `${name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}Icon`;

/** The glyph for a stored icon name; unknown or missing names get the default. */
export function getCollectionGlyph(iconName: string | null): Icon {
  return (iconName && icons[toExportName(iconName)]) || AppsIcon;
}

export function CollectionIcon({
  iconName,
  iconUrl,
  size = 16,
  className,
}: Readonly<{
  iconName: string | null;
  iconUrl: string | null;
  size?: number;
  className?: string;
}>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (iconUrl && iconUrl !== failedUrl) {
    return (
      <img
        className={cn("collection-icon collection-icon--image", className)}
        src={iconUrl}
        alt=""
        onError={() => setFailedUrl(iconUrl)}
      />
    );
  }

  return (
    <span className={cn("collection-icon", className)} aria-hidden="true">
      {createElement(getCollectionGlyph(iconName), { size })}
    </span>
  );
}
