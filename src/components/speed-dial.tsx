"use client";

import {
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
  useColorScheme,
  useMediaQuery,
} from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import HelpIcon from "@mui/icons-material/Help";
import HomeIcon from "@mui/icons-material/Home";
import MapIcon from "@mui/icons-material/Map";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function TransitSpeedDial() {
  const router = useRouter();
  const [isTouch, setIsTouch] = useState(false);
  const [open, setOpen] = useState(false);

  const actions = [
    {
      icon: <HomeIcon />,
      name: "Home",
      onClick: () => {
        router.push("/");
      },
    },
    {
      name: "Help",
      icon: <HelpIcon />,
      onClick: () => {
        router.push("/help");
      },
    },
    {
      name: "Map",
      icon: <MapIcon />,
      onClick: () => {
        router.push("/by-location");
      },
    },
  ];

  const { mode, systemMode, setMode } = useColorScheme();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  const currentMode = mode === "system" ? systemMode : mode;

  if (currentMode === "light") {
    actions.push({
      name: "Dark",
      icon: <DarkModeIcon />,
      onClick: () => {
        if (systemMode === "dark" || prefersDark) {
          setMode("system");
        } else {
          setMode("dark");
        }
      },
    });
  }

  if (currentMode === "dark") {
    actions.push({
      name: "Light",
      icon: <LightModeIcon />,
      onClick: () => {
        if (systemMode === "light" || !prefersDark) {
          setMode("system");
        } else {
          setMode("light");
        }
      },
    });
  }

  useEffect(() => {
    setIsTouch("ontouchstart" in window);
  }, []);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <SpeedDial
      ariaLabel="SpeedDial"
      sx={{ position: "fixed", bottom: 16, right: 16 }}
      icon={<SpeedDialIcon />}
      open={open}
      onOpen={handleOpen}
      onClose={handleClose}
      // this fixes a strange iOS bug where the speed dial would sometimes
      //   require two taps to open. It is unclear why this is necessary.
      onClick={() => setOpen(!open)}
    >
      {actions.map((action) => (
        <SpeedDialAction
          key={action.name}
          icon={action.icon}
          tooltipTitle={action.name}
          tooltipOpen={isTouch}
          onClick={() => {
            action.onClick();
            handleClose();
          }}
          aria-label={action.name}
        />
      ))}
    </SpeedDial>
  );
}
