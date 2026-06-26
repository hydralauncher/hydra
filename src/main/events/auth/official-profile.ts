import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

registerEvent("getOfficialProfile", async () => {
  if (!HydraApi.isSelfHosted()) return null;
  return HydraApi.getOfficialProfile();
});

registerEvent("signInOfficial", async () => {
  // Opens official OAuth window while self-hosted is active
  const { WindowManager } = await import("@main/services");
  const { AuthPage } = await import("@shared");
  const i18next = await import("i18next");
  const searchParams = new URLSearchParams({ lng: i18next.default.language });
  WindowManager.openAuthWindow(AuthPage.SignIn, searchParams);
});
