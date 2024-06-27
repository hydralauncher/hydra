declare module "aria2" {
  export type Aria2Status =
    | "active"
    | "waiting"
    | "paused"
    | "error"
    | "complete"
    | "removed";

  export interface StatusResponse {
    gid: string;
    status: Aria2Status;
    totalLength: string;
    completedLength: string;
    uploadLength: string;
    bitfield: string;
    downloadSpeed: string;
    uploadSpeed: string;
    infoHash?: string;
    numSeeds?: string;
    seeder?: boolean;
    pieceLength: string;
    numPieces: string;
    connections: string;
    errorCode?: string;
    errorMessage?: string;
    followedBy?: string[];
    following: string;
    belongsTo: string;
    dir: string;
    files: {
      path: string;
      length: string;
      completedLength: string;
      selected: string;
    }[];
    bittorrent?: {
      announceList: string[][];
      comment: string;
      creationDate: string;
      mode: "single" | "multi";
      info: {
        name: string;
        verifiedLength: string;
        verifyIntegrityPending: string;
      };
    };
  }

  export default class Aria2 {
    constructor(options: any);
    open: () => Promise<void>;
    call(
      method: "addUri",
      uris: string[],
      options: { dir: string }
    ): Promise<string>;
    call(
      method: "tellStatus",
      gid: string,
      keys?: string[]
    ): Promise<StatusResponse>;
    call(method: "pause", gid: string): Promise<string>;
    call(method: "forcePause", gid: string): Promise<string>;
    call(method: "unpause", gid: string): Promise<string>;
    call(method: "remove", gid: string): Promise<string>;
    call(method: "forceRemove", gid: string): Promise<string>;
    call(method: "pauseAll"): Promise<string>;
    call(method: "forcePauseAll"): Promise<string>;
    listNotifications: () => [
      "onDownloadStart",
      "onDownloadPause",
      "onDownloadStop",
      "onDownloadComplete",
      "onDownloadError",
      "onBtDownloadComplete",
    ];
    on: (event: string, callback: (params: any) => void) => void;
  }
}
