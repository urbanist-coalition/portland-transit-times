"use client";

import { createTheme } from "@mui/material";

export const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: "class",
  },
  colorSchemes: {
    dark: {
      palette: {
        primary: {
          main: "#48c162", // 40% lighter
        },
        secondary: {
          main: "#3abaff", // 40% lighter
        },
      },
    },
  },
  palette: {
    primary: {
      main: "#1A4D25",
    },
    secondary: {
      main: "#0077B6",
    },
  },
});
