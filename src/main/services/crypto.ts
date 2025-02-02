import { safeStorage } from "electron";
import { logger } from "./logger";

export class Crypto {
  public static encrypt(str: string) {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(str).toString("base64");
    } else {
      logger.warn(
        "Encrypt method returned raw string because encryption is not available"
      );

      return str;
    }
  }

  public static decrypt(b64: string) {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(b64, "base64"));
    } else {
      logger.warn(
        "Decrypt method returned raw string because encryption is not available"
      );

      return b64;
    }
  }
}
