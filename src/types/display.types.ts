export interface HydraDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HydraDisplay {
  id: string;
  label: string;
  bounds: HydraDisplayBounds;
  isPrimary: boolean;
  internal: boolean;
}

export interface HydraAudioDevice {
  id: string;
  label: string;
  isDefault: boolean;
}

export type LaunchSource = "default" | "big-picture";
