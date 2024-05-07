import * as styles from "./menu-item.css";

export const MenuItem = ({ title }: { title: string }) => {
  return <div className={styles.menuContextContainer}>{title}</div>;
};
