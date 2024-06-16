import { createContext, useEffect, useState } from "react";
import { UserAuthContext } from "./user-auth.context.types";
import { UserAuth } from "@types";

export const userAuthContext = createContext<UserAuthContext>({
  userAuth: null,
  isLoading: false,
  signout: async () => {},
  updateMe: async () => {},
});

const { Provider } = userAuthContext;
export const { Consumer: UserAuthContextConsumer } = userAuthContext;

export interface UserAuthContextProps {
  children: React.ReactNode;
}

export function UserAuthContextProvider({ children }: UserAuthContextProps) {
  const [userAuth, setUserAuth] = useState<UserAuth | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const updateMe = () => {
    setIsLoading(true);

    return window.electron
      .getMe()
      .then((user) => {
        setUserAuth(user);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    updateMe();
  }, []);

  useEffect(() => {
    const listeners = [
      window.electron.onSignIn(() => {
        updateMe();
      }),
      window.electron.onSignOut(() => {
        setUserAuth(null);
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const signout = () => {
    return window.electron.signout().finally(() => {
      setUserAuth(null);
    });
  };

  return (
    <Provider
      value={{
        userAuth,
        signout,
        updateMe,
        isLoading,
      }}
    >
      {children}
    </Provider>
  );
}
