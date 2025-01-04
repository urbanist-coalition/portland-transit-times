"use client";
import { createContext, useContext } from "react";

import { StopData, LineData } from "@/types";

const StaticDataContext = createContext({
  stops: {} as Record<string, StopData>,
  lines: {} as Record<string, LineData>,
});

interface Props {
  children: React.ReactNode;
  stops: Record<string, StopData>;
  lines: Record<string, LineData>;
}

export const StaticDataProvider = ({
  children,
  stops,
  lines,
}: Props) => {
  return (
    <StaticDataContext.Provider value={{ stops, lines }}>
      {children}
    </StaticDataContext.Provider>
  );
};

export const useStaticData = () => useContext(StaticDataContext);

