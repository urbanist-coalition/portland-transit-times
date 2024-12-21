"use client";

import { ArrowBack } from "@mui/icons-material";
import { IconButton, Tooltip } from "@mui/material";
import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  function goBack() {
    router.back();
  }

  return (
    <Tooltip title="Go Back" arrow>
      <IconButton onClick={goBack}>
        <ArrowBack />
      </IconButton>
    </Tooltip>
  );
}
