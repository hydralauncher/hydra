declare module "node-7z" {
  import { ChildProcess } from "node:child_process";
  import { EventEmitter } from "node:events";

  export interface CommandLineSwitches {
    $bin?: string;
    $progress?: boolean;
    $spawnOptions?: {
      cwd?: string;
    };
    outputDir?: string;
    yes?: boolean;
    password?: string;
    [key: string]: unknown;
  }

  export interface ProgressInfo {
    percent: number;
    fileCount?: number;
  }

  export interface FileInfo {
    file?: string;
    [key: string]: unknown;
  }

  export interface ZipStream extends EventEmitter {
    on(event: "progress", listener: (progress: ProgressInfo) => void): this;
    on(event: "data", listener: (data: FileInfo) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    info: Map<string, unknown>;
    _childProcess?: ChildProcess;
  }

  export function extractFull(
    archive: string,
    output: string,
    options?: CommandLineSwitches
  ): ZipStream;

  export function extract(
    archive: string,
    output: string,
    options?: CommandLineSwitches
  ): ZipStream;

  export function list(
    archive: string,
    options?: CommandLineSwitches
  ): ZipStream;

  export function add(
    archive: string,
    files: string | string[],
    options?: CommandLineSwitches
  ): ZipStream;

  export function update(
    archive: string,
    files: string | string[],
    options?: CommandLineSwitches
  ): ZipStream;

  export function deleteFiles(
    archive: string,
    files: string | string[],
    options?: CommandLineSwitches
  ): ZipStream;

  export function test(
    archive: string,
    options?: CommandLineSwitches
  ): ZipStream;

  const Seven: {
    extractFull: typeof extractFull;
    extract: typeof extract;
    list: typeof list;
    add: typeof add;
    update: typeof update;
    delete: typeof deleteFiles;
    test: typeof test;
  };

  export default Seven;
}
