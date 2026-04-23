import "./styles.scss";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export interface BackdropProps {
  children: ReactNode;
}

export function Backdrop({ children }: Readonly<BackdropProps>) {
  return (
    <motion.div
      className="backdrop"
      initial={{ backgroundColor: "rgba(0, 0, 0, 0)" }}
      animate={{ backgroundColor: "rgba(0, 0, 0, 0.7)" }}
      exit={{ backgroundColor: "rgba(0, 0, 0, 0)" }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}
