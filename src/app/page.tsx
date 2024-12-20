import {
  Container,
  Typography,
  Box,
  Button,
  Link,
} from "@mui/material";
import { RecentStops } from "@/components/recent-stops";
import StopSearch from "@/components/stop-search";

export default function HomePage() {
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Portland Maine Transit Times
      </Typography>
      <Typography gutterBottom>
        Brought to you by the <Link href="https://urbanistportland.me">Urbanist Coalition of Portland</Link> (not affiliated with GPMetro).
      </Typography>
      <Typography variant="body1" gutterBottom>
        Find your stop to keep up to date with real time arrival information!
      </Typography>

      <Box mt={4}>
        <Link href="/by-location">
          <Button
            variant="contained"
            color="primary"
          >
            Find Stops By Location
            Use My Location
          </Button>
        </Link>
      </Box>

      <Box
        display="flex"
        alignItems="center"
        mt={4}
      >
        <Box sx={{ flexGrow: 1, borderBottom: "1px solid #888" }} />
        <Typography variant="body1" sx={{ px: 2 }}>
          OR
        </Typography>
        <Box sx={{ flexGrow: 1, borderBottom: "1px solid #888" }} />
      </Box>

      <StopSearch />
      <RecentStops />


    </Container>
  );
}

