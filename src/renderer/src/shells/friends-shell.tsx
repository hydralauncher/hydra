import { Provider } from "react-redux";

import FriendsWindow from "../pages/friends-window/friends-window";
import { store } from "../store";

export default function FriendsShell() {
  return (
    <Provider store={store}>
      <FriendsWindow />
    </Provider>
  );
}
