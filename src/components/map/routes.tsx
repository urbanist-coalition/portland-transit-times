import { Polyline } from "react-leaflet";

import { useColorMode } from "@/components/color-mode";
import { RouteWithShape } from "@/types";
import { isTooLight } from "@/lib/utils";
import { memo } from "react";

function RoutesRaw({ routes }: { routes: RouteWithShape[] }) {
  const { resolved } = useColorMode();
  return (
    <>
      {/* Near-white routes need a dark backing line to show up on a light map */}
      {resolved === "light" &&
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

export const Routes = memo(RoutesRaw);
