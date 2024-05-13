import { GameRepack } from "@types";
import UsersIcon from "@renderer/assets/users-icon.svg?react";
import SproutIcon from "@renderer/assets/sprout-icon.svg?react";

import { useMagnetHealth } from "./useMagnetHealth";
import { Tooltip } from "@renderer/components/tooltip/tooltip";
import { SeedersAndPeersSkeleton } from "./seeders-and-peers-skeleton";
import { SPACING_UNIT, vars } from "@renderer/theme.css";

interface SeedersAndPeersProps {
  repack: GameRepack;
}

export function SeedersAndPeers({ repack }: Readonly<SeedersAndPeersProps>) {
  const { magnetData, isLoading, error } = useMagnetHealth(repack.magnet);

  if (isLoading) {
    return <SeedersAndPeersSkeleton />;
  }

  if (error) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-around",
      }}
    >
      <Tooltip tooltipText="Seeders">
        <SproutIcon stroke={vars.color.bodyText} />
        <span
          style={{
            marginLeft: `${SPACING_UNIT - 5}px`,
            marginRight: `${SPACING_UNIT}px`,
          }}
        >
          {magnetData?.seeders}
        </span>
      </Tooltip>
      <Tooltip tooltipText="Peers">
        <UsersIcon stroke={vars.color.bodyText} />
        <span
          style={{
            marginLeft: `${SPACING_UNIT - 5}px`,
          }}
        >
          {magnetData?.peers}
        </span>
      </Tooltip>
    </div>
  );
}
