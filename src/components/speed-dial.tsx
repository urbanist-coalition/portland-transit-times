"use client";

import { SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import { Help, Home, Map } from "@mui/icons-material";
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function TransitSpeedDial() {
  const router = useRouter();
  const [isTouch, setIsTouch] = useState(false);
  const [open, setOpen] = useState(false);

  const actions = [{
    icon: <Home />,
    name: 'Home',
    onClick: () => { router.push('/'); }
  }, {
    name: 'Help',
    icon: <Help />,
    onClick: () => { router.push('/help'); }
  }, {
    name: 'Map',
    icon: <Map />,
    onClick: () => { router.push('/map'); },
  }];

  useEffect(() => {
    setIsTouch('ontouchstart' in window);
  }, []);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <SpeedDial
      ariaLabel="SpeedDial"
      sx={{ position: 'fixed', bottom: 16, right: 16 }}
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
