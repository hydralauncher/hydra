import { ClockIcon } from "@phosphor-icons/react";
import { Typography, Box, TitleBox, FocusItem } from "../../../common";
import type { HowLongToBeatCategory } from "@types";

export interface HowLongToBeatBoxProps {
  howLongToBeat: HowLongToBeatCategory[];
}

export function HowLongToBeatBox({
  howLongToBeat,
}: Readonly<HowLongToBeatBoxProps>) {
  return (
    <div className="game-page__box-group">
      <FocusItem>
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
