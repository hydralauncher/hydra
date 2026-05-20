import type { FocusOverrides } from "../../../../services";
import { FocusItem, Typography } from "../../../common";
import { ClockIcon } from "@phosphor-icons/react";
import type { HowLongToBeatCategory } from "@types";

export interface HowLongToBeatBoxProps {
  howLongToBeat: HowLongToBeatCategory[];
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

export function HowLongToBeatBox({
  howLongToBeat,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<HowLongToBeatBoxProps>) {
  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <div className="game-page__sidebar-section game-page__how-long-to-beat">
        <div className="game-page__how-long-to-beat-header">
          <Typography>How Long to Beat</Typography>
        </div>

        <ul className="game-page__how-long-to-beat-list">
          {howLongToBeat?.map((item) => (
            <li key={item.title} className="game-page__how-long-to-beat-item">
              <div className="game-page__how-long-to-beat-duration">
                <ClockIcon
                  size={28}
                  className="game-page__how-long-to-beat-icon"
                />
                <Typography className="game-page__how-long-to-beat-value">
                  {item.duration.split(" ")[0]}
                </Typography>
              </div>

              <div className="game-page__how-long-to-beat-title">
                <Typography className="game-page__how-long-to-beat-label">
                  {item.title}
                </Typography>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </FocusItem>
  );
}
