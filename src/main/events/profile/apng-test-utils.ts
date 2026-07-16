import fs from "node:fs";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createChunk = (type: string, data: Buffer) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length
  );
  return chunk;
};

const createFrameControl = (
  sequence: number,
  width: number,
  height: number,
  delay: number
) => {
  const control = Buffer.alloc(26);
  control.writeUInt32BE(sequence, 0);
  control.writeUInt32BE(width, 4);
  control.writeUInt32BE(height, 8);
  control.writeUInt16BE(delay, 20);
  control.writeUInt16BE(1000, 22);
  return control;
};

const createRawFrame = (
  width: number,
  height: number,
  color: readonly number[]
) => {
  const row = Buffer.alloc(1 + width * 4);
  for (let pixel = 0; pixel < width; pixel++) {
    row.set(color, 1 + pixel * 4);
  }
  return deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
};

export const createAnimatedPng = async (
  filePath: string,
  width = 32,
  height = 20,
  delays = [40, 50, 60],
  loopCount = 2
) => {
  const colors = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
  ] as const;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);

  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(colors.length, 0);
  animationControl.writeUInt32BE(loopCount, 4);

  const chunks = [
    PNG_SIGNATURE,
    createChunk("IHDR", header),
    createChunk("acTL", animationControl),
  ];
  let sequence = 0;

  colors.forEach((color, index) => {
    chunks.push(
      createChunk(
        "fcTL",
        createFrameControl(sequence++, width, height, delays[index])
      )
    );
    const frame = createRawFrame(width, height, color);

    if (index === 0) {
      chunks.push(createChunk("IDAT", frame));
    } else {
      const frameData = Buffer.alloc(4 + frame.length);
      frameData.writeUInt32BE(sequence++, 0);
      frame.copy(frameData, 4);
      chunks.push(createChunk("fdAT", frameData));
    }
  });

  chunks.push(createChunk("IEND", Buffer.alloc(0)));
  await fs.promises.writeFile(filePath, Buffer.concat(chunks));
};
