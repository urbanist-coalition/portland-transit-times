"use client";

import { predictionsByStopCode } from "@/lib/actions";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  Stack,
  Typography,
  Box,
  Button,
  useTheme,
  Chip,
  Collapse,
} from "@mui/material";
import { isTooLight } from "@/lib/utils";
import Link from "next/link";
import MaterialLink from "@mui/material/Link";
import { differenceInMinutes, startOfMinute } from "date-fns";
import { TransitionGroup } from "react-transition-group";
import { LiveStopTimeInstance, StopTimeStatus } from "@/types";
import { formatInTimeZone } from "date-fns-tz";
import { useTimeZone } from "./timezone-cookie";

const FORMAT = "h:mm a";

function _format(date: number, timeZone: string): string {
  return formatInTimeZone(date, timeZone, FORMAT).toLowerCase();
}

function formatPredictedTime(
  date: number,
  now: number,
  timeZone: string,
  departed: boolean
): string {
  const delta = differenceInMinutes(date, now);
  if (delta > 30 || departed) return _format(date, timeZone);
  if (delta < 1) return "Due";
  return `${delta} min`;
}

function ScheduleLabel({ title }: { title: string }) {
  return (
    <strong style={{ width: "72px", display: "inline-block" }}>{title}</strong>
  );
}

function ScheduleTime({ time }: { time: string }) {
  return (
    <span
      style={{ width: "60px", display: "inline-block", textAlign: "right" }}
    >
      {time}
    </span>
  );
}

interface PredictionCardProps {
  prediction: LiveStopTimeInstance;
  now: number;
}

function PredictionCard({ prediction, now }: PredictionCardProps) {
  const theme = useTheme();
  const timeZone = useTimeZone();
  const tooLight = isTooLight(prediction.route.routeColor);

  const delta = differenceInMinutes(
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

  const nowDelta = differenceInMinutes(
    startOfMinute(prediction.scheduledTime),
    startOfMinute(now)
  );
  const departed =
    nowDelta < -1 || prediction.status === StopTimeStatus.departed;

  let statusMessage = "On Time";
  let statusColor = theme.palette.success.main; // green for on time

  if (departed) {
    statusMessage = "Departed";
    statusColor = theme.palette.grey[500]; // grey for departed
  } else if (delta && delta > 0) {
    statusMessage = `${delta} min late`;
    statusColor = theme.palette.error.main; // red for late
  } else if (delta && delta < 0) {
    statusMessage = `${Math.abs(delta)} min early`;
    statusColor = theme.palette.info.main; // blue for early
  }

  return (
    <Card
      variant="outlined"
      sx={{
        borderLeft:
          tooLight && theme.palette.mode === "light"
            ? undefined
            : `8px solid ${prediction.route.routeColor}`,
        mb: 2, // margin bottom for spacing
      }}
    >
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6" component="div" sx={{ fontWeight: "bold" }}>
            <Box
              component="span"
              sx={{
                color: tooLight
                  ? theme.palette.text.primary
                  : prediction.route.routeColor,
                mr: 1,
              }}
            >
              {prediction.route.routeShortName}
            </Box>
            to {prediction.trip.tripHeadsign}
          </Typography>

          <Typography variant="body2">
            <ScheduleLabel title="Scheduled:" />{" "}
            <ScheduleTime time={_format(prediction.scheduledTime, timeZone)} />
          </Typography>

          <Typography variant="body2" component="div">
            <ScheduleLabel title="Predicted:" />{" "}
            <ScheduleTime
              time={formatPredictedTime(
                prediction.predictedTime || 0,
                now,
                timeZone,
                departed
              )}
            />
            <Chip
              label={statusMessage}
              sx={{
                ml: 1,
                bgcolor: statusColor,
                color: theme.palette.getContrastText(statusColor),
                fontWeight: "bold",
                height: "20px",
                "& .MuiChip-label": { p: 0, pl: 1, pr: 1 },
              }}
              size="small"
            />
          </Typography>
        </Stack>
      </CardContent>
    </Card>
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
  const [arrivals, setArrivals] =
    useState<LiveStopTimeInstance[]>(initialArrivals);
  const [now, setNow] = useState(Date.now());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    setLastUpdated(Date.now());
    const pollingInterval = setInterval(async () => {
      try {
        const updatedArrivals = await predictionsByStopCode(stopCode);
        setArrivals(updatedArrivals);
        setLastUpdated(Date.now());
      } catch (error) {
        console.error("Failed to fetch predictions", error);
      }
    }, 5000);

    const nowInterval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(pollingInterval);
      clearInterval(nowInterval);
    };
  }, [stopCode]);

  // Format the lastUpdated timestamp for display
  const lastUpdatedDate = lastUpdated && new Date(lastUpdated);
  const lastUpdatedString =
    lastUpdatedDate &&
    lastUpdatedDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <Box sx={{ pt: 2, pb: 2 }}>
      {arrivals.length === 0 && (
        <Typography variant="h6" align="center" gutterBottom>
          No upcoming arrivals
        </Typography>
      )}
      <TransitionGroup>
        {arrivals.map((prediction, index) => (
          <Collapse
            key={`${prediction.serviceDate}:${prediction.tripId}:${prediction.stopId}`}
            in={false}
            timeout={500}
            unmountOnExit
          >
            <PredictionCard key={index} prediction={prediction} now={now} />
          </Collapse>
        ))}
      </TransitionGroup>
      <Box textAlign="center" mt={2}>
        <Typography variant="caption" display="block" gutterBottom>
          Last updated: {lastUpdatedString}
        </Typography>
        <Link href="/" passHref>
          <Button variant="outlined">Switch Stops</Button>
        </Link>
        <Box textAlign="left" mt={2}>
          <Typography mt={2} variant="h6" gutterBottom>
            Tired of waiting?
          </Typography>
          <Typography>
            Join the Urbanist Coalition of Portland! Aside from projects like
            this website we are advocating to improve Portland{"'"}s transit
            network including more frequency. Anyone can get involved regardless
            of of their background!{" "}
            <MaterialLink
              href="https://urbanistportland.me"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn more
            </MaterialLink>
            .
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
