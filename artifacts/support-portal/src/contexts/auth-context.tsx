/**
 * Shared auth action context.
 *
 * Provides a `signOut` function that works for both auth modes:
 *  - clerk mode  → wraps clerk.signOut()
 *  - local mode  → calls POST /api/auth/logout, then clears query cache
 *
 * Components that need to sign the user out should call useAuthActions()
 * instead of calling useClerk() directly, so they work in both modes.
 */
import { createContext, useContext, type ReactNode } from "react";

interface AuthActions {
  signOut: () => void | Promise<void>;
}

export const AuthActionContext = createContext<AuthActions>({
  signOut: () => {},
});

export function useAuthActions(): AuthActions {
  return useContext(AuthActionContext);
}

export function AuthActionProvider({
  children,
  signOut,
}: {
  children: ReactNode;
  signOut: () => void | Promise<void>;
}) {
  return (
    <AuthActionContext.Provider value={{ signOut }}>
      {children}
    </AuthActionContext.Provider>
  );
}
