import { useTranslation } from "react-i18next";
import cn from "classnames";
import { useGamificationMissions } from "@renderer/hooks";
import type { Mission } from "@types";
import { useMissionActions } from "./use-mission-actions";

export function MissionSwapButton({ mission }: Readonly<{ mission: Mission }>) {
  const { t } = useTranslation("user_profile");
  const { missions } = useGamificationMissions();
  const { swap, isSwapAffordable, pendingAction } = useMissionActions();

  if (!missions) return null;

  const { isFreeAvailable, price } = missions.refresh;
  const canAfford = isSwapAffordable();

  let label = t("swap_paid", { price });
  let hint = t("swap_paid_hint", { price });
  if (isFreeAvailable) {
    label = t("swap_free");
    hint = t("swap_free_hint");
  } else if (!canAfford) {
    label = t("swap_no_funds");
    hint = label;
  }

  return (
    <button
      type="button"
      className={cn("missions-tab__swap", {
        "missions-tab__swap--no-funds": !canAfford,
      })}
      title={hint}
      aria-label={label}
      aria-disabled={!canAfford}
      disabled={pendingAction !== null}
      onClick={() => void swap(mission)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13 8a5 5 0 1 1-1.6-3.7" />
        <path d="M13 2.5v3h-3" />
      </svg>
    </button>
  );
}
