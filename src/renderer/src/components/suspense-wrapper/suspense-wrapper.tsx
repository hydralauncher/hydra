import { Suspense } from "react";

export interface SuspenseWrapperProps {
  Component: React.LazyExoticComponent<() => JSX.Element>;
}

export function SuspenseWrapper({ Component }: SuspenseWrapperProps) {
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}
