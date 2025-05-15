"use client";

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
import { dumbFetch, isTooLight } from "@/lib/utils";
import ArrowRightIcon from "@mui/icons-material/ArrowRightAlt";
import Link from "next/link";
import MaterialLink from "@mui/material/Link";
import { differenceInMinutes, startOfMinute } from "date-fns";
import { TransitionGroup } from "react-transition-group";
import { LiveStopTimeInstance, StopTimeStatus } from "@/types";
import { formatInTimeZone } from "date-fns-tz";
import { useTimeZone } from "./timezone-cookie";

const FORMAT = "h:mm a";
const DEPART_THRESHOLD = 1; // minutes

function _format(date: number, timeZone: string): string {
  return formatInTimeZone(date, timeZone, FORMAT).toLowerCase();
}

function ScheduleTime({ time, updated }: { time: string; updated?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        textDecoration: updated ? "line-through" : undefined,
        textDecorationThickness: updated ? "2px" : undefined,
        fontStyle: updated ? "italic" : undefined,
      }}
    >
      {time}
    </Box>
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
  let statusColor = theme.palette.success.main; // green for on time

  if (skipped) {
    statusMessage = "Canceled";
    statusColor = theme.palette.warning.main; // yellow for skipped
  } else if (departed) {
    statusMessage = "Departed";
    statusColor = theme.palette.grey[500]; // grey for departed
  } else if (schedulDelta && schedulDelta > 0) {
    statusMessage = `${schedulDelta} min late`;
    statusColor = theme.palette.error.main; // red for late
  } else if (schedulDelta && schedulDelta < 0) {
    statusMessage = `${Math.abs(schedulDelta)} min early`;
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
          <Typography variant="h6">
            <Box
              component="span"
              color={
                tooLight
                  ? theme.palette.text.primary
                  : prediction.route.routeColor
              }
              mr={1}
            >
              {prediction.route.routeShortName}
            </Box>
            to {prediction.trip.tripHeadsign}
          </Typography>
          <Typography pl={1} component="div">
            <ScheduleTime
              time={_format(prediction.scheduledTime, timeZone)}
              updated={schedulDelta !== 0 || skipped}
            />
            {schedulDelta !== 0 && (
              <>
                <ArrowRightIcon sx={{ verticalAlign: "middle", pb: "3px" }} />
                <ScheduleTime
                  time={_format(prediction.predictedTime, timeZone)}
                />
              </>
            )}
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
          {!departed && minutesToArrival <= 30 && (
            <Typography color="text.secondary" pl={1}>
              Arriving
              {minutesToArrival <= 0 ? " now" : ` in ${minutesToArrival} min`}
            </Typography>
          )}
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

  useEffect(() => {
    const pollingInterval = setInterval(async () => {
      try {
        const resp = await dumbFetch(`/api/arrivals/${stopCode}`);
        if (resp.status === 304) return; // No new data

        const updatedArrivals = await resp.json();
        setArrivals(updatedArrivals);
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
