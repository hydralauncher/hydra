import { OverlayService } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("getOverlayState", () => OverlayService.getState());
registerEvent("closeOverlay", () => OverlayService.close());
registerEvent("openOverlayPanel", (_event, panel) =>
  OverlayService.openPanel(panel)
);
registerEvent("closeOverlayPanel", (_event, panel) =>
  OverlayService.closePanel(panel)
);
registerEvent("setOverlayPanelPinned", (_event, panel, pinned) =>
  OverlayService.setPanelPinned(panel, Boolean(pinned))
);
registerEvent("getOverlayPanelState", (_event, panel) =>
  OverlayService.getPanelState(panel)
);
registerEvent("getOverlayBrowserState", () => OverlayService.getBrowserState());
registerEvent("navigateOverlayBrowser", (_event, url) =>
  OverlayService.navigateBrowser(url)
);
registerEvent("overlayBrowserGoBack", () => OverlayService.browserGoBack());
registerEvent("overlayBrowserGoForward", () =>
  OverlayService.browserGoForward()
);
registerEvent("overlayBrowserReload", () => OverlayService.browserReload());
registerEvent("overlayBrowserHome", () => OverlayService.browserHome());
