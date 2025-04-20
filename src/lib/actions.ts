"use server";

import { Location } from "@/types";
import { prisma } from "@/lib/prisma";

import { subMinutes } from "date-fns";
import { Route, ServiceAlert, StopTimeInstance } from "@prisma/client";

export interface StopTimeInstanceData extends StopTimeInstance {
  trip: {
    tripHeadsign: string;
    route: {
      routeId: string;
      routeShortName: string;
      routeColor: string;
      routeTextColor: string;
    };
  };
}

export async function predictionsByStopCode(
  stopCode: string
): Promise<StopTimeInstanceData[]> {
  console.log(stopCode);
  return prisma.stopTimeInstance.findMany({
    where: {
      // TODO: fix stopcode situation
      stopId: `0:${stopCode}`,
      estimatedArrival: {
        gte: subMinutes(new Date(), 10),
      },
    },
    include: {
      trip: {
        include: {
          route: {
            select: {
              routeId: true,
              routeShortName: true,
              routeColor: true,
              routeTextColor: true,
            },
          },
        },
      },
    },
    orderBy: {
      estimatedArrival: "asc",
    },
    take: 20,
  });
}

export interface VehicleWithRoute {
  vehicleId: string;
  tripId: string;
  location: Location;
  route: {
    routeId: string;
    routeShortName: string;
    routeColor: string;
    routeTextColor: string;
  };
}

export async function getVehicles(): Promise<VehicleWithRoute[]> {
  const vehicles = await prisma.vehicle.findMany({
    include: {
      trip: {
        include: {
          route: {
            select: {
              routeId: true,
              routeShortName: true,
              routeColor: true,
              routeTextColor: true,
            },
          },
        },
      },
    },
  });

  return vehicles.map((vehicle) => ({
    vehicleId: vehicle.vehicleId,
    tripId: vehicle.tripId,
    location: vehicle.location,
    route: {
      routeId: vehicle.trip.route.routeId,
      routeShortName: vehicle.trip.route.routeShortName,
      routeColor: vehicle.trip.route.routeColor,
      routeTextColor: vehicle.trip.route.routeTextColor,
    },
  }));
}

export async function getServiceAlerts(): Promise<ServiceAlert[]> {
  return prisma.serviceAlert.findMany();
}

export async function getLinesSlim(): Promise<Record<string, Route>> {
  const routes = await prisma.route.findMany();
  const routesRecord: Record<string, Route> = {};
  routes.forEach((route) => {
    routesRecord[route.routeId] = route;
  });
  return routesRecord;
}

export async function getLines(): Promise<Record<string, Route>> {
  const routes = await prisma.route.findMany();
  const routesRecord: Record<string, Route> = {};
  for (const route of routes) {
    routesRecord[route.routeId] = route;
  }
  return routesRecord;
}

export interface StopWithRoutes {
  stopId: string;
  stopName: string;
  stopCode: string;
  location: Location;
  routes: string[];
}

export async function getStops(): Promise<Record<string, StopWithRoutes>> {
  const stops = await prisma.stop.findMany({
    include: {
      stopTimes: {
        select: {
          trip: {
            select: {
              routeId: true,
            },
          },
        },
      },
    },
  });

  const stopsRecord: Record<string, StopWithRoutes> = {};
  stops.forEach(({ stopTimes, ...stop }) => {
    stopsRecord[stop.stopId] = {
      ...stop,
      routes: Array.from(new Set(stopTimes.map(({ trip }) => trip.routeId))),
    };
  });
  return stopsRecord;
}

export async function getStop(
  stopCode: string
): Promise<StopWithRoutes | null> {
  const stop = await prisma.stop.findFirst({
    where: {
      stopCode,
    },
    include: {
      stopTimes: {
        select: {
          trip: {
            select: {
              routeId: true,
            },
          },
        },
      },
    },
  });
  if (!stop) return null;

  const stopRecord: StopWithRoutes = {
    ...stop,
    routes: Array.from(new Set(stop.stopTimes.map(({ trip }) => trip.routeId))),
  };
  return stopRecord;
}
