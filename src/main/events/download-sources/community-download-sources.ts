import puppeteer from "puppeteer";
import { registerEvent } from "../register-event";

const getCommunitySources = async (_event: Electron.IpcMainInvokeEvent) => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  await page.goto("https://hydralinks.cloud/", {
    waitUntil: "domcontentloaded",
  });

  const repackerData = await page.evaluate(() => {
    const repackers = document.querySelectorAll(".repacker-container");
    const data: { key: string; label: string; value: string }[] = [];
    repackers.forEach((re) => {
      data.push({
        key: re.getAttribute("data-repacker") ?? "",
        label: re.getAttribute("data-repacker") ?? "",
        value: `https://hydralinks.cloud/sources/${re.querySelector(".clipboard-button")!.getAttribute("data-url") ?? ""}`,
      });
    });
    return data;
  });

  await browser.close();
  return repackerData;
};

// ipcMain.handle("getCommunitySources", () => getCommunitySources);
registerEvent("getCommunitySources", getCommunitySources);
