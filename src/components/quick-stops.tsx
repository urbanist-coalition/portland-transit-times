"use client";

/**
 * @file This file implements a cookie-based feature for user-saved stops and saving recent stops.
 * Cookies are used so we can server side render components with information about saved stops.
 * For example, the Quick Stop selector will have stops immediately on the first render, instead
 * of having the page render and saved stops populating later. Also, the saved stop star will be
 * properly filled in on the first render instead of possibly flashing empty before filling in.
 *
 * The way this works is implementing a single context that takes in the saved stops, and reacts to
 * any changes to saved stops and stores them in a cookie. In src/app/layout.tsx, we use can load
 * the cookies, pass them into the context, and wrap our app in this context. This means that we
 * can use components with awareness of saved stops on the first render anywhere in the app.
 */

import { allStops } from "@/data/all-stops";
import { StopData } from "@/types";
import { History, Star, StarOutline } from "@mui/icons-material";
import { Box, Chip, IconButton, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { Dispatch, SetStateAction, useEffect, useState } from "react";

import { createContext, useContext } from "react";

const MAX_QUICK_STOPS = 10;

interface StopCode {
  stopCode: string;
}

interface QuickStopsContextValue {
  savedStops: string[];
  setSavedStops: Dispatch<SetStateAction<string[]>>;
  recentStops: string[];
  setRecentStops: Dispatch<SetStateAction<string[]>>;
}

const QuickStopsContext = createContext<QuickStopsContextValue>({
  savedStops: [],
  setSavedStops: () => {},
  recentStops: [],
  setRecentStops: () => {},
});

interface QuickStopsProviderProps {
  children: React.ReactNode;
  savedStops: string[];
  recentStops: string[];
}

export function QuickStopsProvider({
  children,
  savedStops: initialSavedStops,
  recentStops: initialRecentStops,
}: QuickStopsProviderProps) {
  const [savedStops, setSavedStops] = useState(initialSavedStops);
  const [recentStops, setRecentStops] = useState(initialRecentStops);

  // Migrate legacy saved and recent stops from localStorage
  useEffect(() => {
    const legacySavedStops = JSON.parse(
      window.localStorage.getItem("savedStops") || "[]"
    ).map(({ stopCode }: StopCode) => stopCode);
    window.localStorage.removeItem("savedStops");

    if (legacySavedStops.length === 0) return;

    // Never overwrite saved stops if they already exist
    setSavedStops((currentSavedStops) =>
      currentSavedStops.length === 0 ? legacySavedStops : currentSavedStops
    );
  }, []);

  useEffect(() => {
    const legacyRecentStops = JSON.parse(
      window.localStorage.getItem("recentStops") || "[]"
    ).map(({ stopCode }: StopCode) => stopCode);
    window.localStorage.removeItem("recentStops");

    if (legacyRecentStops.length === 0) return;

    // Never overwrite recent stops if they already exist
    setRecentStops((currentRecentStops) =>
      currentRecentStops.length === 0 ? legacyRecentStops : currentRecentStops
    );
  }, []);

  useEffect(() => {
    document.cookie = `savedStops=${JSON.stringify(savedStops)}; path=/; SameSite=Strict`;
  }, [savedStops]);

  useEffect(() => {
    document.cookie = `recentStops=${JSON.stringify(recentStops)}; path=/; SameSite=Strict`;
  }, [recentStops]);

  return (
    <QuickStopsContext.Provider
      value={{
        savedStops,
        setSavedStops,
        recentStops,
        setRecentStops,
      }}
    >
      {children}
    </QuickStopsContext.Provider>
  );
}

export function useQuickStops() {
  return useContext(QuickStopsContext);
}

function toStopData(stopCodes: string[]): StopData[] {
  return stopCodes
    .map((stopCode) => allStops[stopCode])
    .filter((stop): stop is StopData => Boolean(stop));
}

export function AddRecentStop({ stopCode }: StopCode) {
  const { savedStops, setRecentStops } = useQuickStops();
  useEffect(() => {
    if (savedStops.includes(stopCode)) return;

    // Make this a function so this useEffect doesn't need to depend on recentStops which would cause an infinite loop
    setRecentStops((recentStops) =>
      // Add the stop to the front of the list, remove it from the rest of the list, and clip it to the max length
      [
        stopCode,
        ...recentStops.filter((recentStopCode) => recentStopCode !== stopCode),
      ].slice(0, MAX_QUICK_STOPS)
    );
    // This reacts to savedStops so if a user is on a stop's page that has this component and unsaves that stop this
    //   will get triggered and add the stop to the front of recentStops
  }, [savedStops, setRecentStops, stopCode]);
  return null;
}

export function SaveStop({ stopCode }: StopCode) {
  const { savedStops, setSavedStops, recentStops, setRecentStops } =
    useQuickStops();
  const saved = savedStops.includes(stopCode);

  const toggleSaved = () => {
    if (saved) {
      return setSavedStops(savedStops.filter((code) => code !== stopCode));
    }
    // add to saved stops
    setSavedStops([
      stopCode,
      ...savedStops.filter((code) => code !== stopCode),
    ]);
    // remove from recent stops, we don't want recent stops filled up with saved stops
    //   when the stop is unsaved it will be added to the front of recentStops
    setRecentStops(
      recentStops.filter((recentStopCode) => recentStopCode !== stopCode)
    );
  };

  return (
    <IconButton onClick={toggleSaved}>
      {saved ? <Star /> : <StarOutline />}
    </IconButton>
  );
}

export function QuickStops() {
  const router = useRouter();
  const { savedStops, recentStops } = useQuickStops();

  const savedStopsData = toStopData(savedStops);
  const recentStopsData = toStopData(recentStops);

  const clippedRecentStops = recentStopsData
    // Filter out stops that are already saved
    .filter(
      ({ stopCode }) =>
        !savedStops.some((savedStopCode) => savedStopCode === stopCode)
    )
    // We only want up to MAX_QUICK_STOPS items in total so clip these
    .slice(0, MAX_QUICK_STOPS - savedStops.length);

  function goToStop(stopCode: string) {
    return () => {
      router.push(`/stops/${stopCode}`);
    };
  }

  return (
    <Box>
      <Box mt={4}>
        <Typography variant="h6" gutterBottom>
          Quick Stops
        </Typography>
        <Stack
          direction="row"
          flexWrap="wrap"
          rowGap={2} // Vertical spacing
          columnGap={2} // Horizontal spacing
        >
          {savedStopsData.map(({ stopCode, stopName }) => (
            <Chip
              key={stopCode}
              label={`${stopCode}: ${stopName}`}
              onClick={goToStop(stopCode)}
              sx={{ cursor: "pointer" }}
              icon={<Star />}
            />
          ))}
          {clippedRecentStops.map(({ stopCode, stopName }) => (
            <Chip
              key={stopCode}
              label={`${stopCode}: ${stopName}`}
              onClick={goToStop(stopCode)}
              sx={{ cursor: "pointer" }}
              icon={<History />}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
