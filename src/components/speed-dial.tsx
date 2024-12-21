"use client";

import { SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import { Help, Home } from "@mui/icons-material";
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function TransitSpeedDial() {
  const router = useRouter();
  const [isTouch, setIsTouch] = useState(false);

  const actions = [{
    icon: <Home />,
    name: 'Home',
    onClick: () => { router.push('/'); }
  }, {
    name: 'Help',
    icon: <Help />,
    onClick: () => { router.push('/help'); }
  }];

  useEffect(() => {
    setIsTouch('ontouchstart' in window);
  }, []);

  return (
    <SpeedDial
      ariaLabel="SpeedDial basic example"
      sx={{ position: 'fixed', bottom: 16, right: 16 }}
      icon={<SpeedDialIcon />}
    >
      {actions.map((action) => (
        <SpeedDialAction
          key={action.name}
          icon={action.icon}
          tooltipTitle={action.name}
          tooltipOpen={isTouch}
          onClick={action.onClick}
        />
      ))}
    </SpeedDial>
  );
}
