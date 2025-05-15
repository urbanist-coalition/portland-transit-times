import Arrivals from "@/components/arrivals";
import BackButton from "@/components/back-button";
import Footer from "@/components/footer";
import LinePill from "@/components/line-pill";
import { AddRecentStop, SaveStop } from "@/components/quick-stops";
import ServiceAlerts from "@/components/service-alerts";
import { getStop, predictionsByStopCode } from "@/lib/actions";
import { getServiceAlerts } from "@/lib/actions";
import { Container, Typography, Box, Paper } from "@mui/material";

export default async function StopsStopCodePage({
  params,
}: {
  params: Promise<{ stopCode: string }>;
}) {
  const { stopCode } = await params;
  const [stop, serviceAlerts, predictions] = await Promise.all([
    getStop(stopCode),
    getServiceAlerts(),
    predictionsByStopCode(stopCode),
  ]);

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

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box mb={2}>
        <Paper elevation={2} sx={{ mb: 2, p: 1, display: "flex" }}>
          <Box>
            <BackButton />
          </Box>
          <Box flexGrow={1} sx={{ pl: 1 }}>
            <Typography
              variant="h5"
              component="h5"
              gutterBottom
              color="textPrimary"
              sx={{ flexGrow: 1, mb: 0, alignContent: "center" }}
            >
              {stop.stopName}
            </Typography>
            {stop.routes && stop.routes.length > 0 && (
              <Box
                mt={2}
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1,
                  overflowX: "auto", // scroll if too many
                  pb: 1,
                }}
              >
                {stop.routes.map(({ routeId, routeShortName, routeColor }) => {
                  return (
                    <LinePill
                      key={routeId}
                      lineName={routeShortName}
                      lineColor={routeColor}
                    />
                  );
                })}
              </Box>
            )}
          </Box>
          <Box>
            <SaveStop stopCode={stopCode} />
          </Box>
        </Paper>
        <ServiceAlerts serviceAlerts={serviceAlerts} />
      </Box>
      <Arrivals stopCode={stopCode} arrivals={predictions} />
      <AddRecentStop stopCode={stopCode} />
      <Footer />
    </Container>
  );
}
