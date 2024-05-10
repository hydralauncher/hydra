import { GameRepack } from "@types";
import { Sprout, Users } from "lucide-react";

import { useMagnetData } from "./useMagnetData";
import { Tooltip } from "@renderer/components/tooltip/tooltip";
import { SeedersAndPeersSkeleton } from "./seeders-and-peers-skeleton";
import { vars } from "@renderer/theme.css";

interface SeedersAndPeersProps {
  repack: GameRepack;
}

export function SeedersAndPeers({ repack }: Readonly<SeedersAndPeersProps>) {
  const { magnetData, isLoading, error } = useMagnetData(repack.magnet);

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
        <Sprout size={16} stroke={vars.color.bodyText} />
        <span
          style={{
            marginLeft: "7px",
            marginRight: "8px",
          }}
        >
          {magnetData?.seeders}
        </span>
      </Tooltip>
      <Tooltip tooltipText="Peers">
        <Users size={16} stroke={vars.color.bodyText} />
        <span
          style={{
            marginLeft: "7px",
          }}
        >
          {magnetData?.peers}
        </span>
      </Tooltip>
    </div>
  );
}
