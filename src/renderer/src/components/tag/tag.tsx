import * as styles from "./tag.css";

export function Tag({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.tagStyle}>
      <span className={styles.tagText}>{children}</span>
    </div>
  );
}
