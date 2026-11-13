export type CollectionOrderSaves = {
  orders: Readonly<Record<string, readonly string[]>>;
  pending: number;
};

let state: CollectionOrderSaves = { orders: {}, pending: 0 };
const listeners = new Set<() => void>();

const setState = (next: CollectionOrderSaves) => {
  state = next;
  for (const listener of listeners) listener();
};

export const subscribeCollectionOrderSaves = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getCollectionOrderSaves = () => state;

export const beginCollectionOrderSave = (
  collectionId: string,
  order: readonly string[]
) =>
  setState({
    orders: { ...state.orders, [collectionId]: order },
    pending: state.pending + 1,
  });

export const finishCollectionOrderSave = () =>
  setState({ ...state, pending: Math.max(0, state.pending - 1) });

export const clearSettledCollectionOrders = () => {
  if (state.pending === 0 && Object.keys(state.orders).length > 0) {
    setState({ orders: {}, pending: 0 });
  }
};
