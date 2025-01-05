"use client";

import BackButton from "@/components/back-button";
import { Box, Container, Typography } from "@mui/material";
import dynamic from "next/dynamic";

const DynamicMap = dynamic(() => import("@/components/map"), { ssr: false });

export default function MapPage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        <BackButton /> System Map
      </Typography>
      <Box mt={4} mb={4} style={{ height: "400px", width: "100%" }}>
        <DynamicMap location={null} />
      </Box>
    </Container>
  );
}
