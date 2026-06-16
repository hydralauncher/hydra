import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { getRegionsFromSkus, getSkuRegionFlag } from "@renderer/helpers";
import { formatBytes } from "@shared";
import type { DetectedRom, EmulatorSystem } from "@types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  onRescan: () => void;
  disabled?: boolean;
  refreshKey?: number;
}

export function RomsDetectedSection({
  system,
  systemLabel,
  onRescan,
  disabled,
  refreshKey,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const [roms, setRoms] = useState<DetectedRom[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .listEmulatorRoms(system)
      .then((list) => {
        if (!cancelled) setRoms(list);
      })
      .catch(() => {
        if (!cancelled) setRoms([]);
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

      {roms.length === 0 ? (
        <p className="emulator-detail__empty">{t("no_roms_detected")}</p>
      ) : (
        <div className="emulator-detail__roms">
          {roms.map((rom) => {
            const cover = rom.libraryImageUrl ?? rom.iconUrl;
            const regions = getRegionsFromSkus(rom.skus);
            return (
              <div className="emulator-detail__rom" key={rom.objectId}>
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
                    title={rom.title}
                  >
                    {rom.title}
                  </span>
                </div>
                <span
                  className="emulator-detail__rom-leader"
                  aria-hidden="true"
                />
                {rom.sizeBytes !== null && (
                  <span className="emulator-detail__rom-size">
                    {formatBytes(rom.sizeBytes)}
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
