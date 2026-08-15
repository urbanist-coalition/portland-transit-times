"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { differenceInMinutes, startOfMinute } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { ArrowRightIcon } from "@/components/icons";
import useLeavingList from "@/hooks/leaving-list";
import { isTooLight } from "@/lib/utils";
import { LiveStopTimeInstance, StopTimeStatus } from "@/types";

import { useTimeZone } from "./timezone-cookie";
import styles from "./arrivals.module.css";

const FORMAT = "h:mm a";
const DEPART_THRESHOLD = 1; // minutes

// Safe fallback: never render predictions whose time is more than this far in
//   the past. The server only returns instances after `now - 10 min`, so any
//   arrival older than that reached us from a stale source (e.g. a cached HTTP
//   response) and should be dropped rather than shown as a real prediction.
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

function dropStale(
  arrivals: LiveStopTimeInstance[],
  now: number
): LiveStopTimeInstance[] {
  const cutoff = now - STALE_THRESHOLD_MS;
  return arrivals.filter((a) => (a.predictedTime ?? a.scheduledTime) >= cutoff);
}

function _format(date: number, timeZone: string): string {
  return formatInTimeZone(date, timeZone, FORMAT).toLowerCase();
}

function arrivalKey(arrival: LiveStopTimeInstance) {
  return `${arrival.serviceDate}:${arrival.tripId}:${arrival.stopId}`;
}

function ScheduleTime({ time, updated }: { time: string; updated?: boolean }) {
  return (
    <span className={updated ? styles.timeSuperseded : undefined}>{time}</span>
  );
}

interface PredictionCardProps {
  prediction: LiveStopTimeInstance;
  now: number;
}

function PredictionCard({ prediction, now }: PredictionCardProps) {
  const timeZone = useTimeZone();
  const tooLight = isTooLight(prediction.route.routeColor);

  const schedulDelta = differenceInMinutes(
    // Times are displayed to the user rounded to the start of the minute
    //   If we don't do that with the delta it may be off by a minute
    //   For example, if the delta is 80 seconds (predicted 13:00:50, scheduled 13:02:10)
    //   it will look to the user like the difference is 2 minutes but the delta is closer
    //   to 1 minute. Even though the rounding is more accurate it looks wrong to the user.
    //   Sub-minute accuracy is not relevant in the context of bus predictions so it is better
    //   that the delta looks correct.
    startOfMinute(prediction.predictedTime),
    startOfMinute(prediction.scheduledTime)
  );

  const minutesToArrival = differenceInMinutes(
    startOfMinute(prediction.predictedTime),
    startOfMinute(now)
  );
  const skipped = prediction.status === StopTimeStatus.skipped;
  const departed =
    minutesToArrival < -DEPART_THRESHOLD ||
    prediction.status === StopTimeStatus.departed;

  let statusMessage = "On Time";
  let status = "ok";

  if (skipped) {
    statusMessage = "Canceled";
    status = "warn";
  } else if (departed) {
    statusMessage = "Departed";
    status = "idle";
  } else if (schedulDelta && schedulDelta > 0) {
    statusMessage = `${schedulDelta} min late`;
    status = "late";
  } else if (schedulDelta && schedulDelta < 0) {
    statusMessage = `${Math.abs(schedulDelta)} min early`;
    status = "early";
  }

  return (
    <article
      className={styles.card}
      // `data-too-light` lets the stylesheet drop the accent stripe for routes
      //   whose color would be invisible on a light background.
      data-too-light={tooLight}
      style={
        { "--route-color": prediction.route.routeColor } as React.CSSProperties
      }
    >
      <h3 className={styles.route}>
        <span className={styles.routeName}>
          {prediction.route.routeShortName}
        </span>
        <span className={styles.headsign}>
          to {prediction.trip.tripHeadsign}
        </span>
      </h3>

      <p className={styles.times}>
        <ScheduleTime
          time={_format(prediction.scheduledTime, timeZone)}
          updated={schedulDelta !== 0 || skipped}
        />
        {schedulDelta !== 0 && (
          <>
            <ArrowRightIcon size={20} className={styles.arrow} />
            <ScheduleTime time={_format(prediction.predictedTime, timeZone)} />
          </>
        )}
        <span className={styles.status} data-status={status}>
          {statusMessage}
        </span>
      </p>

      {!departed && minutesToArrival <= 30 && (
        <p className={styles.countdown}>
          Arriving
          {minutesToArrival <= 0 ? " now" : ` in ${minutesToArrival} min`}
        </p>
      )}
    </article>
  );
}

interface ArrivalsProps {
  stopCode: string;
  arrivals: LiveStopTimeInstance[];
}

export default function Arrivals({
  stopCode,
  arrivals: initialArrivals,
}: ArrivalsProps) {
  const [arrivals, setArrivals] = useState<LiveStopTimeInstance[]>(() =>
    dropStale(initialArrivals, Date.now())
  );
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Drive the conditional request ourselves instead of relying on the
    //   browser's HTTP cache. Because the API sends `last-modified` without a
    //   `cache-control` directive, the browser applies heuristic freshness and
    //   would serve a stale cached body for minutes without revalidating —
    //   which is how old arrivals "filter in". `cache: "no-store"` keeps the
    //   browser cache out of the loop entirely, and tracking `last-modified`
    //   here preserves the 304 bandwidth savings the API was designed for.
    let lastModified: string | null = null;

    const pollingInterval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/arrivals/${stopCode}`, {
          cache: "no-store",
          headers: lastModified ? { "if-modified-since": lastModified } : {},
        });
        if (resp.status === 304) return; // No new data

        lastModified = resp.headers.get("last-modified") || lastModified;

        const updatedArrivals: LiveStopTimeInstance[] = await resp.json();
        setArrivals(dropStale(updatedArrivals, Date.now()));
      } catch (error) {
        console.error("Failed to fetch predictions", error);
      }
    }, 1000);

    const nowInterval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(pollingInterval);
      clearInterval(nowInterval);
    };
  }, [stopCode]);

  const rows = useLeavingList(arrivals, arrivalKey);

  return (
    <div className={styles.root}>
      {arrivals.length === 0 && (
        <p className={styles.none}>No upcoming arrivals</p>
      )}

      {rows.map(({ item, key, leaving }) => (
        <div key={key} className={leaving ? styles.leaving : styles.entering}>
          <PredictionCard prediction={item} now={now} />
        </div>
      ))}

      <div className={styles.switch}>
        <Link href="/" className="btn btn-outline">
          Switch Stops
        </Link>
      </div>

      <section className={styles.pitch}>
        <h2 className={styles.pitchHeading}>Tired of waiting?</h2>
        <p>
          Join the Urbanist Coalition of Portland! Aside from projects like this
          website we are advocating to improve Portland{"'"}s transit network
          including more frequency. Anyone can get involved regardless of of
          their background!{" "}
          <a
            className="link"
            href="https://urbanistportland.me"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more
          </a>
          .
        </p>
      </section>
    </div>
  );
}
