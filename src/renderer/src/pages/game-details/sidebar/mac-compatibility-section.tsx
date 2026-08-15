import { useContext } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@renderer/components/button/button";
import { gameDetailsContext } from "@renderer/context";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./sidebar.scss";

/**
 * Entry point for the Mac compatibility panel.
 *
 * The panel is only useful for one specific game, so it is opened from
 * the game page with the game identity in the address. Rendering of this
 * section is decided by the caller (sidebar.tsx) so the platform check
 * lives next to the other platform checks.
 */
export function MacCompatibilitySection() {
  const navigate = useNavigate();

  const { game, gameTitle, objectId, shop } = useContext(gameDetailsContext);

  if (!objectId) return null;

  const openPanel = () => {
    const isWindowsExecutable =
      game?.executablePath?.toLowerCase().endsWith(".exe") ?? false;

    const searchParams = new URLSearchParams({
      shop,
      objectId,
      title: gameTitle || objectId,
      isWindowsGame: String(isWindowsExecutable),
    });

    navigate(`/mac-compatibility?${searchParams.toString()}`);
  };

  return (
    <SidebarSection title="Mac Compatibility">
      <div className="mac-compatibility-section">
        <p className="mac-compatibility-section__description">
          Check whether this game can run on your Mac, and let Hydra set up or
          repair what it needs.
        </p>

        <Button
          theme="outline"
          className="mac-compatibility-section__button"
          onClick={openPanel}
        >
          Open Mac compatibility
        </Button>
      </div>
    </SidebarSection>
  );
}
