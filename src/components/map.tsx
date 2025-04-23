"use client";

import "leaflet/dist/leaflet.css";

import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import LocationSearchingIcon from "@mui/icons-material/LocationSearching";
import MaterialLink from "@mui/material/Link";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import { renderToString } from "react-dom/server";
import LinePill from "@/components/line-pill";
import Link from "next/link";
import { isTooLight, locationEquals } from "@/lib/utils";
import { getVehicles } from "@/lib/actions";
import { DirectionsBus } from "@mui/icons-material";
import { Stop, VehiclePosition, Location, RouteWithShape } from "@/lib/model";

interface MapProps {
  location: Location | null;
  stopDistances?: number[];
  allLines: Record<string, RouteWithShape>;
  allStops: Record<string, Stop>;
}

const RecenterAutomatically = ({ location }: { location: Location | null }) => {
  const map = useMap();
  const [hadLocation, setHadLocation] = useState(false);
  useEffect(() => {
    // only center on location when we first get a location
    if (!location || hadLocation) return;
    map.setView(location, 16);
    setHadLocation(true);
  }, [location, hadLocation, map]);

  return null;
};

const CenterMeButton = ({
  location,
  center,
}: {
  location: Location | null;
  center: Location;
}) => {
  const map = useMap();

  if (!location) return null;

  function centerOnLocation() {
    if (!location) return;
    map.setView(location, 16);
  }

  return (
    <Tooltip title="Center on your location" placement="bottom-start">
      <IconButton
        sx={{
          position: "absolute",
          top: 10,
          right: 10,
          // 400 is exactly the minimum needed to be above the map, found with manual binary search
          zIndex: 400,
        }}
        onClick={centerOnLocation}
      >
        {locationEquals(location, center) ? (
          <MyLocationIcon />
        ) : (
          <LocationSearchingIcon />
        )}
      </IconButton>
    </Tooltip>
  );
};

function Pusher({
  setZoom,
  setCenter,
}: {
  setZoom: (zoom: number) => void;
  setCenter: (center: Location) => void;
}) {
  const map = useMap();

  useEffect(() => {
    function handleZoomEnd() {
      setZoom(map.getZoom());
    }

    function handleMoveEnd() {
      setCenter(map.getCenter());
    }

    map.on("zoomend", handleZoomEnd);
    map.on("moveend", handleMoveEnd);
    return () => {
      map.off("zoomend", handleZoomEnd);
      map.off("moveend", handleMoveEnd);
    };
  }, [map, setZoom, setCenter]);

  return null;
}

const generatePieSlices = (colors: string[], radius: number) => {
  const slicePaths = [];
  const center = radius;

  if (colors.length === 1) {
    // Single color: Fill entire circle
    slicePaths.push({
      color: colors[0],
      pathData: `M ${center} ${center} m -${radius}, 0 a ${radius},${radius} 0 1,0 ${radius * 2},0 a ${radius},${radius} 0 1,0 -${radius * 2},0`,
    });
  } else {
    // Multiple colors: Distribute evenly
    const total = colors.length;

    colors.forEach((color, index) => {
      const startAngle = ((index - 0.5) / total) * 2 * Math.PI; // Offset by 90 degrees
      const endAngle = ((index + 0.5) / total) * 2 * Math.PI;

      const startX = center + radius * Math.cos(startAngle);
      const startY = center + radius * Math.sin(startAngle);
      const endX = center + radius * Math.cos(endAngle);
      const endY = center + radius * Math.sin(endAngle);

      const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

      const pathData = `
        M ${center} ${center}
        L ${startX} ${startY}
        A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}
        Z
      `;

      slicePaths.push({ color, pathData });
    });
  }

  return slicePaths;
};

function StopIcon({
  colors,
  size,
  outlineColor = "black",
  outlineWidth = 4, // Reduced to make the outline more subtle
}: {
  colors: string[];
  size: number;
  outlineColor?: string;
  outlineWidth?: number;
}) {
  const radius = size / 2;
  const halfOutline = outlineWidth / 2;
  const innerRadius = radius - halfOutline; // Adjust for the outline width
  const slices = generatePieSlices(colors, innerRadius);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`${-halfOutline} ${-halfOutline} ${size + halfOutline} ${size + halfOutline}`}
    >
      {/* Thin Outline */}
      <circle
        cx={innerRadius}
        cy={innerRadius}
        r={innerRadius}
        fill="none"
        stroke={outlineColor}
        strokeWidth={outlineWidth}
      />

      {/* Pie Slices */}
      {slices.map((slice, index) => (
        <path key={index} d={slice.pathData} fill={slice.color} />
      ))}
    </svg>
  );
}

export function useLiveVehicles(intervalMs = 1000) {
  const [vehicles, setVehicles] = useState<VehiclePosition[]>([]);
  const prevRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function updateVehicles() {
      const newVehicles = await getVehicles();
      if (!cancelled && prevRef.current !== newVehicles.lastUpdated) {
        prevRef.current = newVehicles.lastUpdated;
        setVehicles(newVehicles.vehicles);
      }
    }

    updateVehicles();
    const interval = setInterval(updateVehicles, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intervalMs]);

  return vehicles;
}

export default function Map({
  location,
  stopDistances,
  allLines,
  allStops,
}: MapProps) {
  const [zoom, setZoom] = useState(13);
  const [center, setCenter] = useState({ lat: 43.6632339, lng: -70.2864549 });
  const vehicles = useLiveVehicles();

  const zoomIconSizes: Record<number, number> = {
    13: 10,
    14: 12,
    15: 14,
    16: 16,
    17: 18,
    18: 20,
    19: 22,
    20: 24,
  };

  // For some reason when the map is zoomed out the stops appear to be too low and to the left
  //   These values are picked to make the stops look good at these zoom levels
  //   They are X and Y
  //   - X bigger = left, smaller = right
  //   - Y bigger = up, smaller = down
  const zoonSkew: Record<number, [number, number]> = {
    13: [-2, 2],
    14: [-1, 1],
  };
  const iconSize = zoomIconSizes[zoom] || 10;
  const [skewX, skewY] = zoonSkew[zoom] || [0, 0];

  const theme = useTheme();
  const baseMap =
    theme.palette.mode === "dark" ? "dark_all" : "rastertiles/voyager";
  const baseMapUrl = `https://{s}.basemaps.cartocdn.com/${baseMap}/{z}/{x}/{y}.png`;

  const myLocationDivIcon = L.divIcon({
    html: renderToString(
      <StopIcon
        colors={[theme.palette.secondary.main]}
        size={iconSize + 6}
        outlineColor="white"
      />
    ),
    className: "", // this must be blank or the icons will be in white boxes
  });

  const placeDivIcon = (stop: Stop) => {
    const colors = stop.routes.map(({ routeColor }) => routeColor);

    return L.divIcon({
      html: renderToString(
        <StopIcon
          colors={colors}
          size={iconSize}
          outlineColor={theme.palette.grey["700"]}
        />
      ),
      className: "", // this must be blank or the icons will be in white boxes
      iconAnchor: [iconSize / 2 + skewX, iconSize / 2 + skewY],
    });
  };

  const vehicleIcon = (lineName: string) => {
    const line = Object.values(allLines).find(
      (line) => line.routeShortName === lineName
    );

    return L.divIcon({
      // Wrap the bus icon in a styled div (circle) for the outline and background
      html: renderToString(
        <Box
          style={{
            background: "white",
            border: "1px solid black",
            borderRadius: "50%",
            width: iconSize + 4,
            height: iconSize + 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <DirectionsBus
            style={{
              stroke: "black",
              fill: line?.routeColor || "black",
              width: iconSize,
              height: iconSize,
            }}
          />
        </Box>
      ),
      className: "", // Important for a transparent background in Leaflet
    });
  };

  return (
    <MapContainer
      center={[43.6632339, -70.2864549]}
      zoom={13}
      scrollWheelZoom={true}
      style={{ height: "100%", width: "100%" }}
      zoomControl={false}
      attributionControl={false}
    >
      <Typography
        zIndex={400}
        position="absolute"
        top={4}
        m={1}
        variant="h5"
        p={0.5}
        pr={1}
        pl={1}
        borderRadius={1}
        sx={{
          backgroundColor:
            theme.palette.mode === "dark"
              ? theme.palette.grey["600"]
              : theme.palette.grey["300"],
        }}
      >
        Select a Stop
      </Typography>
      <TileLayer url={baseMapUrl} />
      {vehicles.map(({ vehicleId, route: { routeShortName }, position }) => (
        <Marker
          key={vehicleId}
          position={position}
          icon={vehicleIcon(routeShortName)}
          // This looks a bit weird but it is better for the buses to be behind the stops
          //   so stops don't get hidden. -5 isn't enough but -10 seems to work
          zIndexOffset={-10}
        />
      ))}
      {location && <Marker position={location} icon={myLocationDivIcon} />}
      {zoom > 12 &&
        Object.values(allStops).map((stop, i) => (
          <Marker
            riseOnHover={true}
            key={stop.stopId}
            position={stop.location}
            icon={placeDivIcon(stop)}
          >
            <Popup closeButton={false}>
              <Box sx={{ textAlign: "center" }}>
                <Typography variant="h6" color="textPrimary">
                  {stop.stopName}
                </Typography>
                <Typography variant="caption" color="textPrimary">
                  Stop Number: {stop.stopCode}
                </Typography>
                <br />
                {stopDistances && stopDistances[i] && (
                  <Typography variant="caption" color="textPrimary">
                    {Math.round(stopDistances[i])} meters away
                  </Typography>
                )}
                {stop.routes && stop.routes.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={1}
                    m={1}
                    justifyContent="center"
                  >
                    {stop.routes.map(
                      ({ routeId, routeShortName, routeColor }) => {
                        return (
                          <LinePill
                            key={routeId}
                            lineName={routeShortName}
                            lineColor={routeColor}
                          />
                        );
                      }
                    )}
                  </Stack>
                )}
                <Link href={`/stops/${stop.stopCode}`} passHref>
                  <Button variant="text">View Arrivals</Button>
                </Link>
              </Box>
            </Popup>
          </Marker>
        ))}
      {theme.palette.mode === "light" &&
        Object.values(allLines)
          .filter(({ routeColor }) => isTooLight(routeColor))
          .map(({ routeId, shapes }) => (
            <Polyline
              key={routeId}
              positions={shapes}
              color="black"
              weight={5}
            />
          ))}
      {Object.values(allLines).map(({ routeId, shapes, routeColor }) => (
        <Polyline
          key={routeId}
          positions={shapes}
          color={routeColor}
          opacity={isTooLight(routeColor) ? 1 : 0.5}
          weight={4}
        />
      ))}
      <RecenterAutomatically location={location} />
      <CenterMeButton location={location} center={center} />
      <Pusher setZoom={setZoom} setCenter={setCenter} />
      {/* Custom Attribution */}
      <Paper
        elevation={3}
        sx={{
          position: "absolute",
          bottom: 8,
          left: 8,
          padding: "6px 12px",
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
          zIndex: 400,
        }}
      >
        <Typography variant="body2" component="div" fontSize={10}>
          &copy;{" "}
          <MaterialLink
            href="https://www.openstreetmap.org/copyright"
            color="inherit"
            underline="hover"
          >
            OpenStreetMap
          </MaterialLink>{" "}
          contributors | Map tiles by{" "}
          <MaterialLink
            href="https://carto.com/"
            color="inherit"
            underline="hover"
          >
            Carto
          </MaterialLink>
        </Typography>
      </Paper>
    </MapContainer>
  );
}
