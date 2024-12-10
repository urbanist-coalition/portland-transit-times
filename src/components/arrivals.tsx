"use client";

import { Prediction, predictionsByStopCode } from "@/lib/actions";
import { useEffect, useState } from "react";
import { Card, CardContent, Stack, Typography, Box, Button, useTheme } from "@mui/material";
import { isTooLight, toProperCase } from "@/lib/utils";
import Link from "next/link";
import MaterialLink from "@mui/material/Link";

function formatScheduledTime(secondsFromMidnight: number, now: number): string {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  const arrivalTime = new Date(midnight.getTime() + secondsFromMidnight * 1000);
  const hours = arrivalTime.getHours().toString().padStart(2, "0");
  const minutes = arrivalTime.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatPredictedTime(secondsFromMidnight: number, now: number): string {
  const oneMinute = 60;
  const thirtyMinutes = 30 * oneMinute;

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  const arrivalTime = new Date(midnight.getTime() + secondsFromMidnight * 1000);
  const secondsFromNow = Math.floor((arrivalTime.getTime() - now) / 1000);

  if (secondsFromNow < oneMinute) {
    return "DUE";
  } else if (secondsFromNow <= thirtyMinutes) {
    // Less than or equal to 30 minutes, show minutes only
    const minutes = Math.ceil(secondsFromNow / 60);
    return `${minutes} min`;
  } else {
    // Greater than 30 minutes, show time of day (HH:MM)
    const hours = arrivalTime.getHours().toString().padStart(2, "0");
    const minutes = arrivalTime.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }
}

interface PredictionCardProps {
  prediction: Prediction;
  now: number;
}

function PredictionCard({ prediction, now }: PredictionCardProps) {
  const theme = useTheme();
  const tooLight = isTooLight(prediction.lineColor);

  return (
    <Card
      variant="outlined"
      sx={{
        borderLeft: tooLight && theme.palette.mode === "light" ? undefined : `8px solid ${prediction.lineColor}`,
        mb: 2 // margin bottom for spacing
      }}
    >
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6" component="div" sx={{ fontWeight: 'bold' }}>
            <Box component="span" sx={{ color: tooLight ? theme.palette.text.primary : prediction.lineColor, mr: 1 }}>
              {prediction.lineName}
            </Box>
            to {toProperCase(prediction.destinationLabel)}
          </Typography>

          <Typography variant="body2">
            <strong>Scheduled:</strong> {formatScheduledTime(prediction.scheduledTime, now)}
          </Typography>

          <Typography variant="body2">
            <strong>Predicted:</strong> {formatPredictedTime(prediction.predictedTime, now)}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

interface ArrivalsProps {
  stopCode: string;
  arrivals: Prediction[];
}

export default function Arrivals({ stopCode, arrivals: initialArrivals }: ArrivalsProps) {
  const [arrivals, setArrivals] = useState<Prediction[]>(initialArrivals);
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
    }, 30000);

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
  const lastUpdatedString = lastUpdatedDate && lastUpdatedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <Box sx={{ p: 2 }}>
      {arrivals.map((prediction, index) => (
        <PredictionCard key={index} prediction={prediction} now={now} />
      ))}
      <Box textAlign="center" mt={2}>
        <Typography variant="caption" display="block" gutterBottom>
          Last updated: {lastUpdatedString}
        </Typography>
        <Link href="/" passHref>
          <Button variant="outlined">Switch Stops</Button>
        </Link>
        <Box>
          <Typography mt={2} variant="h6" gutterBottom>
            Tired of waiting?
          </Typography>
          <Typography textAlign="left">
            Join the Urbanist Coalition of Portland! Aside from projects like this website we are advocating to improve Portland{"'"}s transit network including more frequency. Anyone can get involved regardless of of their background! <MaterialLink href="https://urbanistportland.me" target="_blank" rel="noopener noreferrer">Learn more</MaterialLink>.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

