import { Application } from "spectron";
import { join } from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const APP_ROOT = join(__dirname, "..", "..", "..");

const APP_PATH = join(
  APP_ROOT,
  "node_modules",
  ".bin",
  "electron"
);

const MAIN_PATH = join(APP_ROOT, "src", "main", "index.ts");

describe("Nintendo Switch emulator download (E2E)", () => {
  let app: Application;

  beforeAll(async () => {
    app = new Application({
      path: APP_PATH,
      args: [MAIN_PATH],
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
      startTimeout: 120000,
      waitTimeout: 120000,
    });

    await app.start();
  });

  afterAll(async () => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  it("should launch the Hydra app successfully", async () => {
    await app.client.waitUntilWindowLoaded();
    const title = await app.browserWindow.getTitle();
    expect(title).toContain("Hydra");
  });

  it("should show the download emulator button for Nintendo Switch when on emulation settings", async () => {
    await app.client.waitUntilWindowLoaded();

    // Navigate to settings - try common selectors
    const settingsBtn =
      (await app.client.$('[data-testid="settings-button"]')) ??
      (await app.client.$('button[title*="Settings"]')) ??
      (await app.client.$('button[title*="Configurações"]'));

    if (await settingsBtn.isExisting()) {
      await settingsBtn.click();
      await app.client.pause(1000);

      // Navigate to emulation section
      const emulationLink =
        (await app.client.$('[data-testid="emulation-settings"]')) ??
        (await app.client.$('a[href*="emulation"]')) ??
        (await app.client.$('button[href*="emulation"]'));

      if (await emulationLink.isExisting()) {
        await emulationLink.click();
        await app.client.pause(2000);

        // Check for Nintendo Switch card
        const switchCard = await app.client.$(
          '[data-testid="console-card-nintendo-switch"]'
        );

        if (await switchCard.isExisting()) {
          const downloadBtn = await switchCard.$(
            '[data-testid="download-emulator-btn"]'
          );
          if (await downloadBtn.isExisting()) {
            const text = await downloadBtn.getText();
            expect(text).toContain("Download Emulator");
            await downloadBtn.click();
            await app.client.pause(2000);
          }
        }
      }
    }
  });
});
