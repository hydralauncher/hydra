import "./styles.scss";

import { motion, type HTMLMotionProps } from "framer-motion";

export interface AnimatedHeroImageProps
  extends Omit<HTMLMotionProps<"img">, "src"> {
  imageUrl: string;
}

export function AnimatedHeroImage({
  imageUrl,
  alt = "",
  className = "",
  ...props
}: Readonly<AnimatedHeroImageProps>) {
  return (
    <motion.img
      src={imageUrl}
      alt={alt}
      className={`animated-hero-image ${className}`.trim()}
      initial={{ scale: 1, x: 0, y: 0 }}
      animate={{
        scale: 1.1,
        x: -10,
        y: -10,
      }}
      transition={{
        duration: 20,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "mirror",
      }}
      {...props}
    />
  );
}
