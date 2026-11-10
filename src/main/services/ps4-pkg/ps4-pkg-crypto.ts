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
  // XTS on top of ECB: Electron's BoringSSL has no aes-128-xts.
  const tweakCipher = crypto
    .createCipheriv("aes-128-ecb", digest.subarray(0, 16), null)
    .setAutoPadding(false);
  const dataDecipher = crypto
    .createDecipheriv("aes-128-ecb", digest.subarray(16, 32), null)
    .setAutoPadding(false);
  const sectorNumber = Buffer.alloc(16);
  const tweaks = Buffer.alloc(XTS_SECTOR_SIZE);

  const fillTweaks = (sector: number) => {
    sectorNumber.writeBigUInt64LE(BigInt(sector));
    tweakCipher.update(sectorNumber).copy(tweaks, 0);
    for (let block = 16; block < XTS_SECTOR_SIZE; block += 16) {
      const carry = tweaks[block - 1] >> 7;
      for (let byte = 15; byte > 0; byte--) {
        tweaks[block + byte] =
          ((tweaks[block - 16 + byte] << 1) |
            (tweaks[block - 16 + byte - 1] >> 7)) &
          0xff;
      }
      tweaks[block] = ((tweaks[block - 16] << 1) & 0xff) ^ (carry ? 0x87 : 0);
    }
  };

  const xorTweaks = (target: Buffer, offset: number) => {
    for (let index = 0; index < XTS_SECTOR_SIZE; index++) {
      target[offset + index] ^= tweaks[index];
    }
  };

  return (data: Buffer, firstSector: number) => {
    const output = Buffer.from(data);
    for (let offset = 0; offset < output.length; offset += XTS_SECTOR_SIZE) {
      fillTweaks(firstSector + offset / XTS_SECTOR_SIZE);
      xorTweaks(output, offset);
      dataDecipher
        .update(output.subarray(offset, offset + XTS_SECTOR_SIZE))
        .copy(output, offset);
      xorTweaks(output, offset);
    }
    return output;
  };
};
