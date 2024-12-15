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
        Find your stop to keep up to date with real time arrival information!
      </Typography>

      <Box mt={4}>
        <Typography variant="h6" gutterBottom>
          Find Stops By Location
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

      <Box
        display="flex"
        alignItems="center"
        mt={2}
      >
        <Box sx={{ flexGrow: 1, borderBottom: "1px solid #000" }} />
        <Typography variant="body1" sx={{ px: 2 }}>
          OR
        </Typography>
        <Box sx={{ flexGrow: 1, borderBottom: "1px solid #000" }} />
      </Box>

      <StopSearch stopCodes={stopCodes} />
      <RecentStops />


    </Container>
  );
}

