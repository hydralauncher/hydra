import { Trans } from "react-i18next";

import { useAppSelector } from "@renderer/hooks";
import { formatScreenshotHotkey, resolveScreenshotPreferences } from "@shared";

export function GameScreenshotsHotkeyTip() {
  const hotkey = useAppSelector((state) =>
    formatScreenshotHotkey(
      resolveScreenshotPreferences(state.userPreferences.value).hotkey
    )
  );

  return (
    <span className="game-screenshots-box__hint">
      <Trans
        i18nKey="no_screenshots_hotkey_tip"
        ns="screenshots"
        values={{ hotkey }}
        components={[
          <kbd key="hotkey" className="game-screenshots-box__kbd" />,
        ]}
      />
    </span>
  );
}
