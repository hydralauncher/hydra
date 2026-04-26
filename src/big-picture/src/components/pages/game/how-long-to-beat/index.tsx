import { ClockIcon } from "@phosphor-icons/react";
import { Typography, Box, TitleBox, FocusItem } from "../../../common";
import type { HowLongToBeatCategory } from "@types";
import {
  GAME_HOW_LONG_TO_BEAT_TITLE_ID,
  GAME_SCREENSHOT_CAROUSEL_NEXT_BUTTON_ID,
  GAME_STATS_TITLE_ID,
} from "../navigation";
import { FocusOverrides } from "src/big-picture/src/services/navigation.service";

export interface HowLongToBeatBoxProps {
  howLongToBeat: HowLongToBeatCategory[];
}

export function HowLongToBeatBox({
  howLongToBeat,
}: Readonly<HowLongToBeatBoxProps>) {
  const howLongToBeatNavigationOverrides: FocusOverrides = {
    up: {
      type: "item",
      itemId: GAME_STATS_TITLE_ID,
    },
    right: {
      type: "block",
    },
    left: {
      type: "item",
      itemId: GAME_SCREENSHOT_CAROUSEL_NEXT_BUTTON_ID,
    },
  };

  return (
    <div className="game-page__box-group">
      <FocusItem
        id={GAME_HOW_LONG_TO_BEAT_TITLE_ID}
        navigationOverrides={howLongToBeatNavigationOverrides}
      >
        <TitleBox title="How Long to Beat" />
      </FocusItem>

      <ul
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          listStyle: "none",
        }}
      >
        {howLongToBeat?.map((item) => (
          <li
            key={item.title}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              gap: 4,
            }}
          >
            <Box className="game-page__how-long-to-beat-duration">
              <ClockIcon size={20} />
              <Typography variant="h3" style={{ textAlign: "center" }}>
                {item.duration.split(" ")[0]}
              </Typography>
            </Box>

            <Box className="game-page__how-long-to-beat-title">
              <Typography style={{ textAlign: "center" }}>
                {item.title}
              </Typography>
            </Box>
          </li>
        ))}
      </ul>
    </div>
  );
}
