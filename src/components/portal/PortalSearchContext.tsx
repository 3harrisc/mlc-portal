"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface PortalSearchValue {
  query: string;
  setQuery: (q: string) => void;
}

const PortalSearchContext = createContext<PortalSearchValue>({
  query: "",
  setQuery: () => {},
});

export function usePortalSearch(): PortalSearchValue {
  return useContext(PortalSearchContext);
}

export function PortalSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  return (
    <PortalSearchContext.Provider value={{ query, setQuery }}>
      {children}
    </PortalSearchContext.Provider>
  );
}
