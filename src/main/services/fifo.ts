import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import os from "node:os";

export class FIFO {
  public socket: null | net.Socket = null;
  public socketPath = this.generateSocketFilename();

  private generateSocketFilename() {
    const hash = crypto.randomBytes(16).toString("hex");

    if (process.platform === "win32") {
      return "\\\\.\\pipe\\" + hash;
    }

    return path.join(os.tmpdir(), hash);
  }

  public write(data: any) {
    if (!this.socket) return;
    this.socket.write(Buffer.from(JSON.stringify(data)));
  }

  public createPipe() {
    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        this.socket = socket;
        resolve(null);
      });

      server.listen(this.socketPath);
    });
  }
}

export const writePipe = new FIFO();
export const readPipe = new FIFO();
