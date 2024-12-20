"use client";
import { createContext, useContext } from "react";

import { StopData } from "@/types";

const StopsContext = createContext({
  stops: [] as StopData[],
});

interface Props {
  children: React.ReactNode;
  stops: StopData[];
}

export const StopsProvider = ({
  children,
  stops,
}: Props) => {
  return (
    <StopsContext.Provider value={{ stops }}>
      {children}
    </StopsContext.Provider>
  );
};

export const useStops = () => useContext(StopsContext);

