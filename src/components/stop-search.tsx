"use client";

import { allStops } from "@/data/all-stops";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { useRouter } from "next/navigation";

export default function StopSearch() {
  const router = useRouter();

  const handleSelectStop = (stopCode: string) => {
    router.push(`/stops/${stopCode}`);
  };

  return (
    <Box mt={4}>
      <Typography variant="h6" gutterBottom>
        Enter a Stop Number or Name
      </Typography>
      <Autocomplete
        fullWidth
        options={Object.values(allStops)}
        getOptionLabel={(option) => `${option.stopCode} - ${option.stopName}`}
        renderInput={(params) => (
          <TextField {...params} label="Stop Number/Name" />
        )}
        onChange={(_event, value) => {
          if (value && value.stopCode) {
            handleSelectStop(value.stopCode);
          }
        }}
      />
    </Box>
  );
}
