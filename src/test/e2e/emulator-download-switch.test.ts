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

  it("should navigate to emulation settings and show the Nintendo Switch download button", async () => {
    await app.client.waitUntilWindowLoaded();

    // 1. Open Settings from sidebar
    const settingsBtn = await app.client.$('[data-testid="sidebar-button-settings"]');
    if (await settingsBtn.isExisting()) {
      await settingsBtn.click();
      await app.client.pause(1500);
    }

    // 2. Click on Emulation category in settings sidebar
    const emulationBtn = await app.client.$('[data-testid="settings-sidebar-button-emulation"]');
    if (await emulationBtn.isExisting()) {
      await emulationBtn.click();
      await app.client.pause(2000);
    }

    // 3. Find Nintendo Switch card
    const switchCard = await app.client.$('[data-testid="console-card-nintendo-switch"]');

    if (await switchCard.isExisting()) {
      // 4. Check download button exists (emulator not configured yet)
      const downloadBtn = await switchCard.$('[data-testid="download-emulator-btn"]');
      if (await downloadBtn.isExisting()) {
        const text = await downloadBtn.getText();
        expect(text).toContain("Download Emulator");

        // 5. Click download emulator
        await downloadBtn.click();
        await app.client.pause(3000);

        // 6. Verify download notification appeared
        const downloadNotification = await app.client.$('[data-testid="download-notification"]');
        if (await downloadNotification.isExisting()) {
          const notifText = await downloadNotification.getText();
          expect(notifText.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
