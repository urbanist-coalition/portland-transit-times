import { Polyline } from "react-leaflet";
import { useTheme } from "@mui/material";

import { RouteWithShape } from "@/types";
import { isTooLight } from "@/lib/utils";

export function Routes({ routes }: { routes: RouteWithShape[] }) {
  const theme = useTheme();
  return (
    <>
      {theme.palette.mode === "light" &&
        routes
          .filter(({ routeColor }) => isTooLight(routeColor))
          .map(({ routeId, shapes }) => (
            <Polyline
              key={routeId}
              positions={shapes}
              color="black"
              weight={5}
            />
          ))}
      {routes.map(({ routeId, shapes, routeColor }) => (
        <Polyline
          key={routeId}
          positions={shapes}
          color={routeColor}
          opacity={isTooLight(routeColor) ? 1 : 0.5}
          weight={4}
        />
      ))}
    </>
  );
}
