"use client";

import { Prediction, predictionsByStopCode } from "@/lib/actions";
import { useEffect, useState } from "react";
import { Card, CardContent, Stack, Typography, Box, Button, useTheme } from "@mui/material";
import { isTooLight, toProperCase } from "@/lib/utils";
import Link from "next/link";
import MaterialLink from "@mui/material/Link";
import { differenceInMinutes, format } from "date-fns";

const FORMAT = "h:mm";

function formatPredictedTime(date: Date, now: number): string {
  const delta = differenceInMinutes(date, now);
  if (delta > 120) return format(date, FORMAT);
  if (delta < 1) return "Due";
  return `${delta} min`;
}

interface PredictionCardProps {
  prediction: Prediction;
  now: number;
}

function PredictionCard({ prediction, now }: PredictionCardProps) {
  const theme = useTheme();
  const tooLight = isTooLight(prediction.lineColor);

  const delta = differenceInMinutes(prediction.predictedTime, prediction.scheduledTime);
  let lateMessage = "(on time)";
  if (delta > 0) {
    lateMessage = ` (${delta} min late)`;
  }
  if (delta < 0) {
    lateMessage = ` (${Math.abs(delta)} min early)`;
  }


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
            <strong>Scheduled:</strong> {format(prediction.scheduledTime, FORMAT)}
          </Typography>

          <Typography variant="body2">
            <strong>Predicted:</strong> {formatPredictedTime(prediction.predictedTime, now)} {lateMessage}
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
      {arrivals.length === 0 && (
        <Typography variant="h6" align="center" gutterBottom>
          No upcoming arrivals
        </Typography>)}
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

