declare module "aria2" {
  export interface Aria2Options {
    host: string;
    port: number;
    secure: boolean;
    path: string;
  }

  export interface Aria2Status {
    bitfield: string;
    completedLength: string;
    connections: string;
    dir: string;
    downloadSpeed: string;
    files: File[];
    gid: string;
    numPieces: string;
    pieceLength: string;
    status: "active" | "waiting" | "paused" | "error" | "complete" | "removed";
    totalLength: string;
    uploadLength: string;
    uploadSpeed: string;
  }

  export interface Aria2File {
    completedLength: string;
    index: string;
    length: string;
    path: string;
    selected: string;
    uris: string[][];
  }

  export type GUID = string & { __guid: never };

  export type Aria2Methods =
    | "addUri"
    | "addTorrent"
    | "addMetalink"
    | "remove"
    | "forceRemove"
    | "pause"
    | "pauseAll"
    | "forcePause"
    | "forcePauseAll"
    | "unpause"
    | "unpauseAll"
    | "tellStatus"
    | "getUris"
    | "getFiles"
    | "getPeers"
    | "getServers"
    | "tellActive"
    | "tellWaiting"
    | "tellStopped"
    | "changePosition"
    | "changeUri"
    | "getOption"
    | "changeOption"
    | "getGlobalOption"
    | "changeGlobalOption"
    | "getGlobalStat"
    | "purgeDownloadResult"
    | "removeDownloadResult"
    | "getVersion"
    | "getSessionInfo"
    | "shutdown"
    | "forceShutdown"
    | "saveSession"
    | "multicall";

  export default class Aria2 {
    constructor(options: Aria2Options[]);
    secret: string;

    open(): Promise<void>;
    call(
      method: "addUri",
      params: [string],
      options?: { dir: string }
    ): Promise<GUID>;
    call(method: "tellStatus", params: GUID): Promise<Aria2Status>;
    call(method: "pause", params: GUID): Promise<void>;
    call(method: "unpause", params: GUID): Promise<void>;
    call(method: "remove", params: GUID): Promise<void>;
    call(method: Aria2Methods, params: any[]): Promise<any>;

    emit(ev: string, payload: any): void;
    on(ev: string, listener: (payload: any) => void): void;
  }
}
