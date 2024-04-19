import { vars } from "@renderer/theme.css";
import Skeleton from "react-loading-skeleton";
import * as styles from "./patch-notes-skeleton.css";

const patchNoteList = [
  { width: 300 },
  { width: 350 },
  { width: 400 },
  { width: 250 },
  { width: 280 },
  { width: 500 },
  { width: 700 },
];

export function PatchNotesSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, i) => {
        return (
          <div className={styles.container} key={i}>
            <div className={styles.sectionHeader}>
              <Skeleton
                width={64}
                height={22}
                baseColor={vars.color.borderColor}
              />
              <Skeleton
                width={96}
                height={19}
                baseColor={vars.color.borderColor}
              />
            </div>

            <ul className={styles.patchNoteList}>
              {patchNoteList.map((item) => (
                <Skeleton
                  key={item.width}
                  width={item.width}
                  height={19}
                  baseColor={vars.color.borderColor}
                />
              ))}
            </ul>

            <div className={styles.sectionHeader}>
              <span className={styles.releaseAssets}>
                <Skeleton
                  width={16}
                  height={16}
                  baseColor={vars.color.borderColor}
                  borderRadius={"100%"}
                />

                <Skeleton
                  width={58}
                  height={17}
                  baseColor={vars.color.borderColor}
                />
              </span>

              <Skeleton
                width={20}
                height={20}
                baseColor={vars.color.borderColor}
                borderRadius="100%"
              />
            </div>

            <Skeleton
              width={"100%"}
              height={1}
              baseColor={vars.color.borderColor}
            />
          </div>
        );
      })}
    </>
  );
}
