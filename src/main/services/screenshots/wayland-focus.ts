import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { logger } from "../logger";
import { NativeAddon } from "../native-addon";

export type WaylandFocusSource = "hyprland" | "sway" | "kde";

export interface WaylandFocus {
  source: WaylandFocusSource;
  processId: number | null;
}

const SOCKET_TIMEOUT_MS = 500;
const I3_IPC_MAGIC = Buffer.from("i3-ipc", "ascii");
const I3_IPC_HEADER_SIZE = I3_IPC_MAGIC.length + 8;
const I3_IPC_GET_TREE = 4;

const requestUnixSocket = (
  socketPath: string,
  payload: Buffer,
  isComplete: (response: Buffer) => boolean
) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.createConnection({ path: socketPath });
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS, () =>
      finish(new Error(`Timed out reading ${socketPath}`))
    );
    socket.once("error", (error) => finish(error));
    socket.once("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      if (isComplete(Buffer.concat(chunks))) finish();
    });
    socket.once("end", () => finish());
  });

const toProcessId = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

const findHyprlandSocket = (signature: string) => {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const candidates = [
    runtimeDir
      ? path.join(runtimeDir, "hypr", signature, ".socket.sock")
      : null,
    path.join("/tmp", "hypr", signature, ".socket.sock"),
  ];
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== null && fs.existsSync(candidate)
  );
};

const getHyprlandFocus = async (socketPath: string) => {
  const response = await requestUnixSocket(
    socketPath,
    Buffer.from("j/activewindow"),
    () => false
  );
  const activeWindow = JSON.parse(response.toString("utf8")) as {
    pid?: unknown;
  };
  return toProcessId(activeWindow.pid);
};

interface SwayNode {
  focused?: boolean;
  pid?: unknown;
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

const findFocusedSwayNode = (node: SwayNode): SwayNode | null => {
  if (node.focused) return node;
  for (const child of [...(node.nodes ?? []), ...(node.floating_nodes ?? [])]) {
    const focused = findFocusedSwayNode(child);
    if (focused) return focused;
  }
  return null;
};

const readI3IpcPayloadLength = (response: Buffer) =>
  response.length >= I3_IPC_HEADER_SIZE
    ? response.readUInt32LE(I3_IPC_MAGIC.length)
    : null;

const getSwayFocus = async (socketPath: string) => {
  const header = Buffer.alloc(I3_IPC_HEADER_SIZE);
  I3_IPC_MAGIC.copy(header);
  header.writeUInt32LE(0, I3_IPC_MAGIC.length);
  header.writeUInt32LE(I3_IPC_GET_TREE, I3_IPC_MAGIC.length + 4);

  const response = await requestUnixSocket(socketPath, header, (current) => {
    const payloadLength = readI3IpcPayloadLength(current);
    return (
      payloadLength !== null &&
      current.length >= I3_IPC_HEADER_SIZE + payloadLength
    );
  });
  const payloadLength = readI3IpcPayloadLength(response);
  if (payloadLength === null) throw new Error("Sway IPC reply was truncated");

  const tree = JSON.parse(
    response
      .subarray(I3_IPC_HEADER_SIZE, I3_IPC_HEADER_SIZE + payloadLength)
      .toString("utf8")
  ) as SwayNode;
  return toProcessId(findFocusedSwayNode(tree)?.pid);
};

const isKdeSession = () =>
  (process.env.XDG_CURRENT_DESKTOP ?? "")
    .split(":")
    .some((desktop) => desktop.toUpperCase() === "KDE");

const readFocus = async (
  source: WaylandFocusSource,
  read: () => Promise<number | null>
): Promise<WaylandFocus | null> => {
  try {
    return { source, processId: await read() };
  } catch (error) {
    logger.warn("Failed to read the focused Wayland window", {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const readHyprlandFocus = async () => {
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  const socketPath = signature ? findHyprlandSocket(signature) : undefined;
  if (!socketPath) return null;
  return readFocus("hyprland", () => getHyprlandFocus(socketPath));
};

const readSwayFocus = async () => {
  const socketPath = process.env.SWAYSOCK;
  if (!socketPath || !fs.existsSync(socketPath)) return null;
  return readFocus("sway", () => getSwayFocus(socketPath));
};

const readKdeFocusNow = (): WaylandFocus | null => {
  if (!isKdeSession()) return null;
  const processId = NativeAddon.getKdeFocusedProcessId();
  return processId === undefined ? null : { source: "kde", processId };
};

const readKdeFocus = async () => readKdeFocusNow();

const focusReaders = [readHyprlandFocus, readSwayFocus, readKdeFocus];

export const getWaylandFocus = async (): Promise<WaylandFocus | null> => {
  for (const readWaylandFocus of focusReaders) {
    const focus = await readWaylandFocus();
    if (focus) return focus;
  }
  return null;
};

export const startWaylandFocusWatch = () => {
  if (isKdeSession()) NativeAddon.startKdeFocusWatch();
};

export const stopWaylandFocusWatch = () => {
  NativeAddon.stopKdeFocusWatch();
};
