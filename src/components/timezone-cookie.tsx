"use client";

import { createContext, useContext, useEffect } from "react";

const TimeZoneContext = createContext("America/New_York");

interface TimeZoneProviderProps {
  children: React.ReactNode;
  timeZone: string;
}

export function TimeZoneProvider({
  children,
  timeZone,
}: TimeZoneProviderProps) {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = `tz=${tz}; path=/; max-age=31536000`; // 1 year
  }, []);

  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

export function useTimeZone() {
  return useContext(TimeZoneContext);
}
