"use client";

import { StopData } from "@/types";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import Link from "next/link";
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
        // TODO: inject allStops here
        // options={Object.values(allStops)}
        options={[] as StopData[]}
        getOptionLabel={(option) => `${option.stopCode} - ${option.stopName}`}
        renderInput={(params) => (
          <TextField {...params} label="Stop Number/Name" />
        )}
        // Links prefetch the stops that show up in the dropdown
        renderOption={({ key, ...props }, option) => (
          <Link key={key} href={`/stops/${option.stopCode}`}>
            <Box component="li" {...props}>
              {option.stopCode} - {option.stopName}
            </Box>
          </Link>
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
