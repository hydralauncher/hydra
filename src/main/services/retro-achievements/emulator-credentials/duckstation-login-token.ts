import crypto from "node:crypto";

const AES_BLOCK_SIZE = 16;
const KEY_STRETCH_ROUNDS = 100;

const sha256 = (data: Buffer) =>
  crypto.createHash("sha256").update(data).digest();

const getLoginEncryptionKey = (username: string, machineKey: Buffer | null) => {
  let key = sha256(
    Buffer.concat([machineKey ?? Buffer.alloc(0), Buffer.from(username)])
  );

  for (let round = 0; round < KEY_STRETCH_ROUNDS; round += 1) {
    key = sha256(key);
  }

  return key;
};

const createCipherParameters = (
  username: string,
  machineKey: Buffer | null
) => {
  const key = getLoginEncryptionKey(username, machineKey);
  return { key: key.subarray(0, 16), iv: key.subarray(16, 32) };
};

export const encryptDuckStationLoginToken = (
  token: string,
  username: string,
  machineKey: Buffer | null
) => {
  const { key, iv } = createCipherParameters(username, machineKey);
  const data = Buffer.alloc(
    Math.ceil(Buffer.byteLength(token) / AES_BLOCK_SIZE) * AES_BLOCK_SIZE
  );
  data.write(token);

  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);

  return Buffer.concat([cipher.update(data), cipher.final()]).toString(
    "base64"
  );
};

export const decryptDuckStationLoginToken = (
  encryptedToken: string,
  username: string,
  machineKey: Buffer | null
) => {
  const data = Buffer.from(encryptedToken, "base64");
  if (data.length === 0 || data.length % AES_BLOCK_SIZE !== 0) return null;

  const { key, iv } = createCipherParameters(username, machineKey);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  const end = decrypted.indexOf(0);
  return decrypted.subarray(0, end === -1 ? decrypted.length : end).toString();
};
