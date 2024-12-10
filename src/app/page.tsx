import {
  Container,
  Typography,
  Box,
  Button,
  Link,
} from "@mui/material";
import { RecentStops } from "@/components/recent-stops";
import StopSearch from "@/components/stop-search";
import { minimalStops } from "@/lib/actions";

export default async function HomePage() {
  const stopCodes = await minimalStops();
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Transit Times
      </Typography>
      <Typography gutterBottom>
        Brought to you by the <Link href="https://urbanistportland.me">Urbanist Coalition of Portland</Link>.
      </Typography>
      <Typography variant="body1" gutterBottom>
        Select your stop for real time arrival information:
      </Typography>

      <StopSearch stopCodes={stopCodes} />
      <RecentStops />

      <Box mt={4}>
        <Typography variant="h6" gutterBottom>
          Or Find Stops By Location
        </Typography>
        <Link href="/by-location">
          <Button
            variant="contained"
            color="primary"
          >
            Use My Location
          </Button>
        </Link>
      </Box>

    </Container>
  );
}

