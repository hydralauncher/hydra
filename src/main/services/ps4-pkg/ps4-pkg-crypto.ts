import crypto from "node:crypto";

import { Ps4PkgError, type Ps4PkgEntry } from "./ps4-pkg-info";

export interface Ps4PkgRsaKey {
  modulus: string;
  privateExponent: string;
}

/** The keys to open fake PKGs. They come from the Hydra API, not the code. */
export interface Ps4PkgKeys {
  pkgDerivedKey3: Ps4PkgRsaKey;
  fake: Ps4PkgRsaKey;
}

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
    // Wrong keys decrypt to noise, so this is how bad keys show up.
    throw new Ps4PkgError(
      "bad_keys",
      "PKG key block has an unexpected padding"
    );
  }

  const separator = block.indexOf(0, 2);
  if (separator === -1) {
    throw new Ps4PkgError("bad_keys", "PKG key block has no separator");
  }
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

export const decryptDk3 = (entryKeys: Buffer, keys: Ps4PkgKeys) => {
  const keySlotOffset = 32 + 7 * 32 + DK3_KEY_INDEX * RSA_SIZE;
  return rsaDecrypt(
    keys.pkgDerivedKey3,
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
  imageKey: Buffer,
  keys: Ps4PkgKeys
) =>
  rsaDecrypt(
    keys.fake,
    aesCbcDecrypt(entryCipherKey(imageKeyEntry, dk3), imageKey)
  ).subarray(0, 32);

/** Native AES-128-XTS from hydra-native; decrypts the sectors in place. */
export type NativeSectorDecryptor = (
  tweakKey: Buffer,
  dataKey: Buffer,
  data: Buffer,
  firstSector: number
) => void;

let nativeDecryptor: NativeSectorDecryptor | null = null;

export const setNativeSectorDecryptor = (
  decryptor: NativeSectorDecryptor | null
) => {
  nativeDecryptor = decryptor;
};

/** Returns a function that decrypts whole sectors; it may reuse `data`. */
export const createSectorDecryptor = (ekpfs: Buffer, seed: Buffer) => {
  const index = Buffer.alloc(4);
  index.writeUInt32LE(1);
  const digest = crypto
    .createHmac("sha256", ekpfs)
    .update(index)
    .update(seed)
    .digest();

  if (nativeDecryptor) {
    const decrypt = nativeDecryptor;
    const tweakKey = Buffer.from(digest.subarray(0, 16));
    const dataKey = Buffer.from(digest.subarray(16, 32));
    return (data: Buffer, firstSector: number) => {
      decrypt(tweakKey, dataKey, data, firstSector);
      return data;
    };
  }

  // Without the addon: XTS on top of ECB, since Electron's BoringSSL has no
  // aes-128-xts. ECB is only the block step here: the per-block tweaks below
  // make it XTS, the mode the PKG format uses, and this only decrypts.
  const tweakCipher = crypto
    .createCipheriv("aes-128-ecb", digest.subarray(0, 16), null) // NOSONAR
    .setAutoPadding(false);
  const dataDecipher = crypto
    .createDecipheriv("aes-128-ecb", digest.subarray(16, 32), null) // NOSONAR
    .setAutoPadding(false);
  const wordsPerSector = XTS_SECTOR_SIZE / 4;

  /** Copies into a fresh array, so the 32-bit view is aligned. */
  const toWords = (bytes: Uint8Array) => {
    const copy = new Uint8Array(bytes);
    return new Uint32Array(copy.buffer, 0, copy.length / 4);
  };

  // The extraction speed is set by this decryption, so the tweaks are built
  // and applied 32 bits at a time and each read is a single AES call.
  const buildTweaks = (sectors: number, firstSector: number) => {
    const numbers = Buffer.alloc(sectors * 16);
    for (let sector = 0; sector < sectors; sector++) {
      numbers.writeBigUInt64LE(BigInt(firstSector + sector), sector * 16);
    }
    const first = toWords(tweakCipher.update(numbers));
    const tweaks = new Uint32Array(sectors * wordsPerSector);
    let word = 0;
    for (let sector = 0; sector < sectors; sector++) {
      let a = first[sector * 4];
      let b = first[sector * 4 + 1];
      let c = first[sector * 4 + 2];
      let d = first[sector * 4 + 3];
      for (let block = 0; block < wordsPerSector / 4; block++) {
        tweaks[word++] = a;
        tweaks[word++] = b;
        tweaks[word++] = c;
        tweaks[word++] = d;
        // Multiplies the tweak by x in GF(2^128), little-endian.
        const carry = d >>> 31;
        d = (d << 1) | (c >>> 31);
        c = (c << 1) | (b >>> 31);
        b = (b << 1) | (a >>> 31);
        a = (a << 1) ^ (carry ? 0x87 : 0);
      }
    }
    return tweaks;
  };

  const xorWords = (target: Uint32Array, tweaks: Uint32Array) => {
    for (let index = 0; index < target.length; index++) {
      target[index] ^= tweaks[index];
    }
  };

  return (data: Buffer, firstSector: number) => {
    const tweaks = buildTweaks(data.length / XTS_SECTOR_SIZE, firstSector);
    const cipher = toWords(data);
    xorWords(cipher, tweaks);
    const plain = toWords(
      dataDecipher.update(new Uint8Array(cipher.buffer, 0, data.length))
    );
    xorWords(plain, tweaks);
    return Buffer.from(plain.buffer, 0, data.length);
  };
};
