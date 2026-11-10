import crypto from "node:crypto";

import type { Ps4PkgEntry } from "./ps4-pkg-info";
import {
  FAKE_KEYSET,
  PKG_DERIVED_KEY3_KEYSET,
  type Ps4PkgRsaKey,
} from "./ps4-pkg-keys";

export const XTS_SECTOR_SIZE = 0x1000;

const RSA_SIZE = 256;
const DK3_KEY_INDEX = 3;

const modPow = (base: bigint, exponent: bigint, modulus: bigint) => {
  let result = 1n;
  let value = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    remaining >>= 1n;
  }
  return result;
};

const rsaDecrypt = (key: Ps4PkgRsaKey, cipher: Buffer) => {
  const message = modPow(
    BigInt(`0x${cipher.toString("hex")}`),
    BigInt(`0x${key.privateExponent}`),
    BigInt(`0x${key.modulus}`)
  );
  const block = Buffer.from(
    message.toString(16).padStart(RSA_SIZE * 2, "0"),
    "hex"
  );

  if (block[0] !== 0 || block[1] !== 2) {
    throw new Error("PKG key block has an unexpected padding");
  }

  const separator = block.indexOf(0, 2);
  if (separator === -1) throw new Error("PKG key block has no separator");
  return block.subarray(separator + 1);
};

const entryCipherKey = (entry: Ps4PkgEntry, dk3: Buffer) =>
  crypto.createHash("sha256").update(entry.raw).update(dk3).digest();

const aesCbcDecrypt = (cipherKey: Buffer, data: Buffer) => {
  const decipher = crypto
    .createDecipheriv(
      "aes-128-cbc",
      cipherKey.subarray(16, 32),
      cipherKey.subarray(0, 16)
    )
    .setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
};

export const decryptDk3 = (entryKeys: Buffer) => {
  const keySlotOffset = 32 + 7 * 32 + DK3_KEY_INDEX * RSA_SIZE;
  return rsaDecrypt(
    PKG_DERIVED_KEY3_KEYSET,
    entryKeys.subarray(keySlotOffset, keySlotOffset + RSA_SIZE)
  ).subarray(0, 32);
};

export const canDecryptEntry = (entry: Ps4PkgEntry) =>
  entry.keyIndex === DK3_KEY_INDEX;

export const decryptEntry = (entry: Ps4PkgEntry, dk3: Buffer, data: Buffer) =>
  aesCbcDecrypt(entryCipherKey(entry, dk3), data);

export const decryptEkpfs = (
  imageKeyEntry: Ps4PkgEntry,
  dk3: Buffer,
  imageKey: Buffer
) =>
  rsaDecrypt(
    FAKE_KEYSET,
    aesCbcDecrypt(entryCipherKey(imageKeyEntry, dk3), imageKey)
  ).subarray(0, 32);

export const createSectorDecryptor = (ekpfs: Buffer, seed: Buffer) => {
  const index = Buffer.alloc(4);
  index.writeUInt32LE(1);
  const digest = crypto
    .createHmac("sha256", ekpfs)
    .update(index)
    .update(seed)
    .digest();
  const xtsKey = Buffer.concat([
    digest.subarray(16, 32),
    digest.subarray(0, 16),
  ]);

  return (data: Buffer, firstSector: number) => {
    const output = Buffer.allocUnsafe(data.length);
    const tweak = Buffer.alloc(16);
    for (let offset = 0; offset < data.length; offset += XTS_SECTOR_SIZE) {
      tweak.writeBigUInt64LE(BigInt(firstSector + offset / XTS_SECTOR_SIZE));
      crypto
        .createDecipheriv("aes-128-xts", xtsKey, tweak)
        .update(data.subarray(offset, offset + XTS_SECTOR_SIZE))
        .copy(output, offset);
    }
    return output;
  };
};
