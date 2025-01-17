import { Container, Typography, Box, Button } from "@mui/material";
import NextLink from "next/link";
import { RecentStops } from "@/components/recent-stops";
import StopSearch from "@/components/stop-search";
import Footer from "@/components/footer";

export default function HomePage() {
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Portland, ME Transit
      </Typography>
      <Typography variant="body1" gutterBottom>
        Find your stop to keep up to date with <strong>real time</strong>{" "}
        arrivals!
      </Typography>

      <Box mt={4} textAlign="center">
        <NextLink href="/by-location" style={{ display: "inline" }}>
          <Button variant="contained" color="primary">
            Find Stops By Location
          </Button>
        </NextLink>
      </Box>

      <Box display="flex" alignItems="center" mt={4}>
        <Box sx={{ flexGrow: 1, borderBottom: "1px solid #888" }} />
        <Typography variant="body1" sx={{ px: 2 }}>
          OR
        </Typography>
        <Box sx={{ flexGrow: 1, borderBottom: "1px solid #888" }} />
      </Box>

      <StopSearch />
      <RecentStops />
      <Footer />
    </Container>
  );
}
