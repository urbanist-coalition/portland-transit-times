"use client";

import { MinimalStop } from "@/types";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { useRouter } from "next/navigation";

interface StopSearchProps {
  stopCodes: MinimalStop[]
}

export default function StopSearch({ stopCodes }: StopSearchProps) {
  const router = useRouter();

  const handleSelectStop = (stopCode: string) => {
    router.push(`/stops/${stopCode}`);
  };

  return (
    <Box mt={4}>
      <Typography variant="h6" gutterBottom>
        Enter a Stop Number
      </Typography>
      <Autocomplete
        fullWidth
        options={stopCodes}
        getOptionLabel={(option) => `${option.stopCode} - ${option.stopName}`}
        renderInput={(params) => <TextField {...params} label="Stop Code" />}
        onChange={(_event, value) => {
          if (value && value.stopCode) {
            handleSelectStop(value.stopCode);
          }
        }}
      />
    </Box>);
}
