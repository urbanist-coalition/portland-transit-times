"use client";

import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { useStaticData } from "@/components/static-data-provider";

export default function StopSearch() {
  const { stops } = useStaticData();
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
        options={Object.values(stops)}
        getOptionLabel={(option) => `${option.stopCode} - ${option.stopName}`}
        renderInput={(params) => <TextField {...params} label="Stop Number/Name" />}
        onChange={(_event, value) => {
          if (value && value.stopCode) {
            handleSelectStop(value.stopCode);
          }
        }}
      />
    </Box>);
}
