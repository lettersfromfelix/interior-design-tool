import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { AppState, AppStore } from "../state/store";

export const StoreContext = createContext<AppStore | null>(null);

export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreContext is missing");
  return store;
}

/** Subscribe to a slice of the app state. Selectors must return stable values (primitives or existing objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useAppStore(), selector);
}
