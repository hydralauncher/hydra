import React from "react";
import {
  FileDirectoryIcon,
  DeviceDesktopIcon,
  ZapIcon,
  LocationIcon,
  RocketIcon,
  TrophyIcon,
  ProjectIcon,
  FlameIcon,
  EyeClosedIcon,
  PulseIcon,
  ToolsIcon,
  CircleIcon,
  PeopleIcon,
  PersonIcon,
  DeviceCameraVideoIcon,
  StarIcon,
  ClockIcon,
  ListUnorderedIcon,
  BroadcastIcon,
  TrashIcon,
  GearIcon,
  ArchiveIcon,
  SlidersIcon,
  type Icon,
} from "@primer/octicons-react";

interface FolderIconProps {
  iconId?: string;
  size?: number;
  className?: string;
}

export function FolderIcon({
  iconId = "folder",
  size = 24,
  className,
}: FolderIconProps) {
  const iconMap: Record<string, Icon> = {
    // Ícones básicos
    folder: FileDirectoryIcon,
    archive: ArchiveIcon,

    // Ícones de categorias de jogos
    games: DeviceDesktopIcon,
    action: ZapIcon,
    adventure: LocationIcon,
    racing: RocketIcon,
    sports: TrophyIcon,
    strategy: ProjectIcon,
    rpg: FlameIcon,
    horror: EyeClosedIcon,
    puzzle: PulseIcon,
    simulation: ToolsIcon,
    indie: CircleIcon,

    // Ícones de modo de jogo
    multiplayer: PeopleIcon,
    singleplayer: PersonIcon,

    // Ícones de mídia e interface
    image: DeviceCameraVideoIcon,
    retro: DeviceCameraVideoIcon,
    favorite: StarIcon,
    clock: ClockIcon,
    time: ClockIcon,
    document: ListUnorderedIcon,
    list: ListUnorderedIcon,
    microphone: BroadcastIcon,
    mic: BroadcastIcon,
    trash: TrashIcon,
    settings: GearIcon,
    gear: GearIcon,
    controls: SlidersIcon,
    mixer: SlidersIcon,
  };

  const getIcon = () => {
    const IconComponent = iconMap[iconId] || FileDirectoryIcon;
    return React.createElement(IconComponent, { size });
  };

  return <span className={className}>{getIcon()}</span>;
}
