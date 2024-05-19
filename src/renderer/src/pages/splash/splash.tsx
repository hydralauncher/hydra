import icon from "@renderer/assets/icon.png";
import * as styles from "./splash.css";
import { themeClass } from "../../theme.css";

import "../../app.css";

document.body.classList.add(themeClass);

export default function Splash() {
  return (
    <main className={styles.main}>
      <img src={icon} className={styles.splashIcon} alt="" />
      <p>Procurando atualizaçoes</p>
    </main>
  );
}
