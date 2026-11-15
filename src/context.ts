import { createContext, useContext } from "react";
import type { Bootstrap, CartLine, MenuItem, Order } from "./types";
export interface AppContextValue {
  data: Bootstrap;
  refresh: () => Promise<void>;
  nav: (page: string) => void;
  scrollToTop: () => void;
  page: string;
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  notice: (message: string) => void;
  selectedItem: MenuItem | null;
  setSelectedItem: (item: MenuItem | null) => void;
  cart: CartLine[];
  setCart: (cart: CartLine[]) => void;
  storeId: string;
  setStoreId: (id: string) => void;
  lastOrder: Order | null;
  setLastOrder: (order: Order | null) => void;
  logout: () => Promise<void>;
}
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
