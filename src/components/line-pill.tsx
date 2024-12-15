"use client"

import { isTooLight } from "@/lib/utils";
import { Chip, useTheme } from "@mui/material";

interface LinePillProps {
  lineName: string;
  lineColor: string;
}

export default function LinePill({ lineName, lineColor }: LinePillProps) {
  const theme = useTheme();
  const tooLight = isTooLight(lineColor);

  return (
    <Chip
      label={lineName}
      sx={{
        backgroundColor: lineColor,
        color: theme.palette.getContrastText(lineColor),
        border: tooLight ? "1px solid #000" : "none",
        fontWeight: "bold",
      }}
    />
  );
}
