"use client";

import { StarOutline, Star } from "@mui/icons-material";
import { IconButton, Tooltip } from "@mui/material";
import { useState } from "react";

interface StopCode {
  stopCode: string;
}

function getFavoriteStopCodes(): StopCode[] {
  return JSON.parse(window.localStorage.getItem("favoriteStops") || "[]");
}

export default function StopStar({ stopCode }: StopCode) {
  const [favoriteStops, setFavoriteStops] = useState<StopCode[]>(
    getFavoriteStopCodes()
  );
  const isFavorite = favoriteStops.some((stop) => stop.stopCode === stopCode);

  function toggleFavorite() {
    if (isFavorite) {
      const updatedFavorites = favoriteStops.filter(
        (stop) => stop.stopCode !== stopCode
      );
      window.localStorage.setItem(
        "favoriteStops",
        JSON.stringify(updatedFavorites)
      );
      setFavoriteStops(updatedFavorites);
    } else {
      const updatedFavorites = [{ stopCode }, ...favoriteStops];
      window.localStorage.setItem(
        "favoriteStops",
        JSON.stringify(updatedFavorites)
      );
      setFavoriteStops(updatedFavorites);
    }
  }

  return (
    <Tooltip title="Go Back" arrow>
      <IconButton onClick={toggleFavorite}>
        {isFavorite ? <Star /> : <StarOutline />}
      </IconButton>
    </Tooltip>
  );
}
