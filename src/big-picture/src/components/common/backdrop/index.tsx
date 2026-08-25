import "./styles.scss";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export interface BackdropProps {
  children: ReactNode;
  className?: string;
}

export function Backdrop({ children, className }: Readonly<BackdropProps>) {
  return (
    <motion.div
      className={className ? `backdrop ${className}` : "backdrop"}
      initial={{ backgroundColor: "rgba(0, 0, 0, 0)" }}
      animate={{ backgroundColor: "rgba(0, 0, 0, 0.7)" }}
      exit={{ backgroundColor: "rgba(0, 0, 0, 0)" }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}
