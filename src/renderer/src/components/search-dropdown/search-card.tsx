import { useState, useEffect, useMemo } from "react";
import { SearchIcon } from "@primer/octicons-react";
import { useSteamGridCover } from "@renderer/hooks/use-steamgrid-cover";
import type { SearchSuggestion } from "@renderer/hooks/use-search-suggestions";
import Skeleton from "react-loading-skeleton";
import { globalImageCache } from "@renderer/helpers";
import { useRef } from "react";

interface SearchCardProps {
  item: SearchSuggestion;
  isActive: boolean;
  onClick: () => void;
}

function getSteamPrimaryUrl(objectId: string): string {
  return `https://steamcdn-a.akamaihd.net/steam/apps/${objectId}/library_600x900_2x.jpg`;
}

export function SearchCard({ item, isActive, onClick }: SearchCardProps) {
  const initialPrimarySrc =
    item.shop === "steam"
      ? getSteamPrimaryUrl(item.objectId)
      : (item.libraryImageUrl ?? item.iconUrl ?? null);

  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [finalFailed, setFinalFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const steamGridUrl = useSteamGridCover(
    item.objectId,
    item.title,
    fallbackIndex > 0
  );

  const steamHeader =
    item.shop === "steam"
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.objectId}/header.jpg`
      : null;

  const fallbackSources = useMemo(() => {
    const sources: (string | null | undefined)[] = [initialPrimarySrc];

    if (steamGridUrl) sources.push(steamGridUrl);

    sources.push(item.libraryImageUrl);

    if (item.shop === "steam") {
      sources.push(
        `https://steamcdn-a.akamaihd.net/steam/apps/${item.objectId}/library_600x900.jpg`
      );
      sources.push(
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.objectId}/capsule_616x353.jpg`
      );
      sources.push(steamHeader);
    }

    sources.push(item.iconUrl);

    return Array.from(new Set(sources.filter(Boolean))) as string[];
  }, [
    initialPrimarySrc,
    steamGridUrl,
    item.libraryImageUrl,
    item.shop,
    item.objectId,
    steamHeader,
    item.iconUrl,
  ]);

  const activeSrc =
    fallbackIndex === 0
      ? initialPrimarySrc
      : fallbackIndex > 0 && steamGridUrl === undefined
        ? undefined
        : fallbackSources[fallbackIndex];

  const cardClass = `search-dropdown__card${isActive ? " search-dropdown__card--active" : ""}`;

  const [imageLoaded, setImageLoaded] = useState(() =>
    activeSrc ? globalImageCache.has(activeSrc) : false
  );

  const handleImageError = () => {
    if (fallbackIndex < fallbackSources.length - 1) {
      setFallbackIndex((prev) => prev + 1);
    } else {
      setFinalFailed(true);
    }
  };

  // Reset loaded state when source changes
  useEffect(() => {
    setImageLoaded(activeSrc ? globalImageCache.has(activeSrc) : false);
    if (activeSrc && imgRef.current?.complete) {
      if (imgRef.current.naturalWidth > 0) {
        globalImageCache.add(activeSrc);
        setImageLoaded(true);
      } else {
        handleImageError();
      }
    }
  }, [activeSrc]);

  return (
    <button type="button" className={cardClass} onClick={onClick}>
      <div
        className="search-dropdown__card-image"
        style={{ position: "relative" }}
      >
        {activeSrc && !finalFailed && !imageLoaded && (
          <Skeleton
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              borderRadius: "inherit",
              height: "100%",
            }}
          />
        )}
        {activeSrc &&
        !finalFailed &&
        (!activeSrc &&
          steamGridUrl !== undefined &&
          fallbackIndex >= fallbackSources.length) === false ? (
          <img
            ref={imgRef}
            key={activeSrc}
            src={activeSrc}
            alt={item.title}
            draggable={false}
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth <= 1) {
                handleImageError();
              } else {
                if (activeSrc) globalImageCache.add(activeSrc);
                setImageLoaded(true);
              }
            }}
            style={{
              opacity: imageLoaded ? 1 : 0,
              transition: "opacity 0.3s ease",
            }}
            onError={handleImageError}
          />
        ) : (
          <div className="card-placeholder">
            <SearchIcon size={24} />
          </div>
        )}
      </div>
      <div className="search-dropdown__card-title">{item.title}</div>
    </button>
  );
}
