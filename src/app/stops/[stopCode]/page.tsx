import Arrivals from "@/components/arrivals";
import BackButton from "@/components/back-button";
import LinePill from "@/components/line-pill";
import { AddRecentStop } from "@/components/recent-stops";
import {
  getAllLines,
  predictionsByStopCode,
  stopByStopCode,
} from "@/lib/actions";
import { Container, Typography, Box, Stack } from "@mui/material";

export default async function StopsStopCodePage({
  params,
}: {
  params: Promise<{ stopCode: string }>;
}) {
  const { stopCode } = await params;
  const lines = await getAllLines();
  const stop = await stopByStopCode(stopCode);
  const predictions = await predictionsByStopCode(stopCode);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box mb={2}>
        <Typography variant="h4" component="h1" gutterBottom>
          <BackButton />
          {stop.stopName}
        </Typography>
        {stop.lineIds && stop.lineIds.length > 0 && (
          <Stack direction="row" spacing={1} mb={2}>
            {stop.lineIds.map((lineId) => {
              const { lineName, lineColor } = lines[lineId];
              return (
                <LinePill
                  key={lineId}
                  lineName={lineName}
                  lineColor={lineColor}
                />
              );
            })}
          </Stack>
        )}
      </Box>
      <Arrivals stopCode={stopCode} arrivals={predictions} />
      <AddRecentStop stopCode={stopCode} stopName={stop.stopName} />
    </Container>
  );
}
