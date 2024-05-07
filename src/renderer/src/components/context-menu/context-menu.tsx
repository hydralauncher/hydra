import { useEffect, useState } from "react";
import * as styles from "./context-menu.css";
import { MenuItem } from "./menu-item";

export const ContextMenu = ({ data }: { data: any }) => {
  const [clicked, setClicked] = useState(false);
  const [axilCoordinates, setAxilCoordinates] = useState({
    x: 0,
    y: 0,
  });

  useEffect(() => {
    const handleClick = () => setClicked(false);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <div>
      {data.map((item) => (
        <div
          key={item.id}
          onContextMenu={(e) => {
            e.preventDefault();
            setClicked(true);
            setAxilCoordinates({
              x: e.pageX,
              y: e.pageY,
            });
            console.log("Right Click", e.pageX, e.pageY);
          }}
        >
          <MenuItem title={item.title} />
        </div>
      ))}

      {clicked && (
        <div className={styles.contextMenu} top={points.y} left={points.x}>
          <ul className={styles.contextMenuList}>
            <li>Edit</li>
            <li>Copy</li>
            <li>Delete</li>
          </ul>
        </div>
      )}
    </div>
  );
};
