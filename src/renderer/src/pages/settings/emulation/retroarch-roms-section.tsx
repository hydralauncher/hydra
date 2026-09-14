import { RETROARCH_PLATFORM_LABELS } from "@renderer/helpers";
import type { DetectedRom, RetroArchPlatform } from "@types";

import { RomsSection } from "./roms-detected-section";
import { RETROARCH_LABEL } from "./retroarch-meta";

interface Props {
  refreshKey?: number;
}

type RetroArchRom = DetectedRom & { platform: RetroArchPlatform };

export function RetroArchRomsSection({ refreshKey }: Readonly<Props>) {
  return (
    <RomsSection<RetroArchRom>
      systemLabel={RETROARCH_LABEL}
      refreshKey={refreshKey}
      loadRoms={() => window.electron.listRetroArchRoms()}
      romMatchesQuery={(rom, q) =>
        rom.title.toLowerCase().includes(q) ||
        RETROARCH_PLATFORM_LABELS[rom.platform].toLowerCase().includes(q)
      }
      renderRowExtra={(rom) => (
        <span className="emulator-detail__rom-size">
          {RETROARCH_PLATFORM_LABELS[rom.platform]}
        </span>
      )}
    />
  );
}
