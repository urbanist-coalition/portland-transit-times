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

import { History, Star, StarOutline } from "@mui/icons-material";
import { Box, Chip, IconButton, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dispatch, SetStateAction, useEffect, useState } from "react";

import { createContext, useContext } from "react";

import { Stop } from "@/lib/model";
import { filterMap } from "@/lib/utils";

const MAX_QUICK_STOPS = 10;

function getCookieValue(name: string) {
  // Split the string of all cookies into individual "name=value" strings
  const allCookies = document.cookie.split("; ");

  // Find a cookie that starts with "name="
  const targetCookie = allCookies.find((cookie) =>
    cookie.startsWith(`${name}=`)
  );
  if (!targetCookie) {
    return null;
  }

  // Return everything after "name="
  // You may want to decode in case the cookie was URI-encoded
  const value = targetCookie.substring(name.length + 1);
  return decodeURIComponent(value);
}

interface StopCode {
  stopCode: string;
}

interface QuickStopsContextValue {
  savedStops: string[];
  setSavedStops: Dispatch<SetStateAction<string[] | undefined>>;
  recentStops: string[];
  setRecentStops: Dispatch<SetStateAction<string[] | undefined>>;
}

const QuickStopsContext = createContext<QuickStopsContextValue>({
  savedStops: [],
  setSavedStops: () => {},
  recentStops: [],
  setRecentStops: () => {},
});

interface QuickStopsProviderProps {
  children: React.ReactNode;
  savedStops?: string[];
  recentStops?: string[];
}

function syncStopList(
  stops: string[] | undefined,
  key: string,
  setStops: Dispatch<SetStateAction<string[] | undefined>>
) {
  if (!stops) {
    // In case for whatever reason the back end couldn't read the cookie, check for it on the front end
    const existingStops = getCookieValue(key);
    if (existingStops) setStops(JSON.parse(existingStops));
    // Exit early so we never overwrite with an empty array
    return;
  }
  // One year in seconds
  const maxAge = 365 * 24 * 60 * 60;
  document.cookie = `${key}=${JSON.stringify(stops)}; path=/; SameSite=Lax; max-age=${maxAge}`;
}

export function QuickStopsProvider({
  children,
  savedStops: initialSavedStops,
  recentStops: initialRecentStops,
}: QuickStopsProviderProps) {
  const [savedStops, setSavedStops] = useState(initialSavedStops);
  const [recentStops, setRecentStops] = useState(initialRecentStops);

  useEffect(() => {
    syncStopList(savedStops, "savedStops", setSavedStops);
  }, [savedStops]);

  useEffect(() => {
    syncStopList(recentStops, "recentStops", setRecentStops);
  }, [recentStops]);

  return (
    <QuickStopsContext.Provider
      value={{
        savedStops: savedStops || [],
        setSavedStops,
        recentStops: recentStops || [],
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

export function AddRecentStop({ stopCode }: StopCode) {
  const { recentStops, setRecentStops } = useQuickStops();
  useEffect(() => {
    if (recentStops.includes(stopCode)) return;

    // Make this a function so this useEffect doesn't need to depend on recentStops which would cause an infinite loop
    setRecentStops((recentStops) =>
      // Add the stop to the front of the list, remove it from the rest of the list, and clip it to the max length
      [
        stopCode,
        ...(recentStops || []).filter(
          (recentStopCode) => recentStopCode !== stopCode
        ),
      ].slice(0, MAX_QUICK_STOPS)
    );
    // This reacts to savedStops so if a user is on a stop's page that has this component and unsaves that stop this
    //   will get triggered and add the stop to the front of recentStops
  }, [recentStops, setRecentStops, stopCode]);

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

export function QuickStops({ allStops }: { allStops: Record<string, Stop> }) {
  const router = useRouter();
  const { savedStops, recentStops } = useQuickStops();

  const savedStopsData = filterMap(
    savedStops,
    (stopCode) => allStops[stopCode]
  );
  const recentStopsData = filterMap(
    recentStops,
    (stopCode) => allStops[stopCode]
  );

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
            <Link key={stopCode} href={`/stops/${stopCode}`}>
              <Chip
                key={stopCode}
                label={`${stopCode}: ${stopName}`}
                onClick={goToStop(stopCode)}
                sx={{ cursor: "pointer" }}
                icon={<Star />}
              />
            </Link>
          ))}
          {clippedRecentStops.map(({ stopCode, stopName }) => (
            <Link key={stopCode} href={`/stops/${stopCode}`}>
              <Chip
                key={stopCode}
                label={`${stopCode}: ${stopName}`}
                onClick={goToStop(stopCode)}
                sx={{ cursor: "pointer" }}
                icon={<History />}
              />
            </Link>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
