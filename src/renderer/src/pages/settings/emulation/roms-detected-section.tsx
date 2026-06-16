import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { getRegionsFromSkus, getSkuRegionFlag } from "@renderer/helpers";
import { formatBytes } from "@shared";
import type { EmulatorSystem, LibraryGame } from "@types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  onRescan: () => void;
  disabled?: boolean;
  refreshKey?: number;
}

const matchesSystem = (
  platform: string | null | undefined,
  system: EmulatorSystem
): boolean => {
  if (!platform) return false;
  const p = platform.toLowerCase();
  if (/playstation\s*3|\bps3\b/.test(p)) return system === "ps3";
  if (/playstation\s*2|\bps2\b/.test(p)) return system === "ps2";
  if (/playstation|\bps1\b|\bpsx\b/.test(p)) return system === "ps1";
  return false;
};

export function RomsDetectedSection({
  system,
  systemLabel,
  onRescan,
  disabled,
  refreshKey,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const [games, setGames] = useState<LibraryGame[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .getLibrary()
      .then((library) => {
        if (cancelled) return;
        const detected = library
          .filter(
            (game) =>
              game.shop === "launchbox" && matchesSystem(game.platform, system)
          )
          .sort((a, b) => a.title.localeCompare(b.title));
        setGames(detected);
      })
      .catch(() => {
        if (!cancelled) setGames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [system, refreshKey]);

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <h3>{t("roms_detected_title")}</h3>
          <p>{t("roms_detected_description", { system: systemLabel })}</p>
        </div>
        <Button theme="outline" onClick={onRescan} disabled={disabled}>
          <SyncIcon size={13} />
          <span>{t("rescan")}</span>
        </Button>
      </header>

      {games.length === 0 ? (
        <p className="emulator-detail__empty">{t("no_roms_detected")}</p>
      ) : (
        <div className="emulator-detail__roms">
          {games.map((game) => {
            const cover = game.libraryImageUrl ?? game.iconUrl;
            const size =
              game.installedSizeInBytes ?? game.installerSizeInBytes ?? null;
            const regions = getRegionsFromSkus(
              (game.discs ?? [])
                .map((disc) => disc.sku ?? "")
                .filter((sku) => sku.length > 0)
            );
            return (
              <div className="emulator-detail__rom" key={game.id}>
                <div className="emulator-detail__rom-game">
                  <div className="emulator-detail__rom-cover">
                    {cover && (
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span
                    className="emulator-detail__rom-title"
                    title={game.title}
                  >
                    {game.title}
                  </span>
                </div>
                <span
                  className="emulator-detail__rom-leader"
                  aria-hidden="true"
                />
                {size !== null && (
                  <span className="emulator-detail__rom-size">
                    {formatBytes(size)}
                  </span>
                )}
                {regions.length > 0 && (
                  <span className="emulator-detail__rom-regions">
                    {regions.map((region) => (
                      <img
                        key={region}
                        className="emulator-detail__rom-flag"
                        src={getSkuRegionFlag(region)}
                        alt={region}
                        title={region}
                      />
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
