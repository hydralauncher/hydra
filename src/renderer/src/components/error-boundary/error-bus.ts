type BoundaryListener = (message: string) => void;

const listeners = new Set<BoundaryListener>();

export const errorBus = {
  notifyBoundaryHandled(message: string) {
    listeners.forEach((listener) => listener(message));
  },
  onBoundaryHandled(listener: BoundaryListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
