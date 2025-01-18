import Arrivals from "@/components/arrivals";
import BackButton from "@/components/back-button";
import Footer from "@/components/footer";
import LinePill from "@/components/line-pill";
import { AddRecentStop, SaveStop } from "@/components/quick-stops";
import ServiceAlerts from "@/components/service-alerts";
import { allLines, allStops } from "@/constants";
import { predictionsByStopCode } from "@/lib/actions";
import { getServiceAlerts } from "@/lib/service-alerts";
import { filterMap } from "@/lib/utils";
import { Container, Typography, Box, Stack } from "@mui/material";

export default async function StopsStopCodePage({
  params,
}: {
  params: Promise<{ stopCode: string }>;
}) {
  const { stopCode } = await params;
  const stop = allStops[stopCode];
  const serviceAlerts = await getServiceAlerts();

  if (!stop) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Stop Not Found
        </Typography>
        <Typography variant="body1" gutterBottom color="textPrimary">
          We couldn{"'"}t find a stop with the code {stopCode}. Please try
          again.
        </Typography>
        <BackButton />
        <Footer />
      </Container>
    );
  }

  const predictions = await predictionsByStopCode(stopCode);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box mb={2}>
        <Typography
          variant="h4"
          component="h1"
          gutterBottom
          color="textPrimary"
        >
          <BackButton />
          {stop.stopName}
          <SaveStop stopCode={stopCode} />
        </Typography>
        <ServiceAlerts serviceAlerts={serviceAlerts} />
        {stop.lineIds && stop.lineIds.length > 0 && (
          <Stack direction="row" spacing={1} mb={2}>
            {filterMap(stop.lineIds, (i) => allLines[i])
              .map(({ lineId, lineName, lineColor }) => {
                return (
                  <LinePill
                    key={lineId}
                    lineName={lineName}
                    lineColor={lineColor}
                  />
                );
              })
              .filter(Boolean)}
          </Stack>
        )}
      </Box>
      <Arrivals stopCode={stopCode} arrivals={predictions} />
      <AddRecentStop stopCode={stopCode} />
      <Footer />
    </Container>
  );
}
