import Arrivals from "@/components/arrivals";
import { AddRecentStop } from "@/components/recent-stops";
import { minimalStops, stopByStopCode } from "@/lib/actions";
import { isTooLight, toProperCase } from "@/lib/utils";
import { Container, Typography, Box, Chip, Stack } from "@mui/material";

interface LinePillProps {
  lineName: string;
  lineColor: string;
}

function LinePill({ lineName, lineColor }: LinePillProps) {
  const tooLight = isTooLight(lineColor);

  return (
    <Chip
      label={lineName}
      sx={{
        backgroundColor: lineColor,
        color: !tooLight ? "#fff" : "#000",
        border: tooLight ? "1px solid #000" : "none",
        fontWeight: "bold",
      }}
    />
  );
}

export async function generateStaticParams() {
  const stops = await minimalStops();
  return stops.map(({ stopCode }) => ({ stopCode }));
}

export default async function StopsStopCodePage({ params }: { params: Promise<{ stopCode: string; }> }) {
  const { stopCode } = await params;
  const stop = await stopByStopCode(stopCode);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box mb={2}>
        <Typography variant="h4" component="h1" gutterBottom>
          {toProperCase(stop.stopName)}
        </Typography>
        {stop.lines && stop.lines.length > 0 && (
          <Stack direction="row" spacing={1} mb={2}>
            {stop.lines.map(({ stopId, lineName, lineColor }) => (
              <LinePill key={stopId} lineName={lineName} lineColor={lineColor} />
            ))}
          </Stack>
        )}
      </Box>
      <Arrivals stopCode={stopCode} />
      <AddRecentStop stopCode={stopCode} stopName={stop.stopName} />
    </Container>
  );
}
