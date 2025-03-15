export interface Location {
  lat: number;
  lng: number;
  cap?: number;
}

export interface LineDataSlim {
  lineId: number;
  lineName: string;
  lineColor: string;
}

export interface LineData extends LineDataSlim {
  points: Location[][];
}

export interface StopData {
  stopId: number;
  stopName: string;
  stopCode: string;
  location: Location;
  lineIds: number[];
}

export interface VehicleData {
  vehicleId: number;
  lineName: string;
  location: Location;
}

// Based on the item type from rss-parser but with mandatory title, content, and isoDate
export interface ServiceAlert {
  title: string;
  link?: string;
  pubDate?: string;
  content: string;
  contentSnippet?: string;
  guid?: string;
  isoDate: string;
  enclosure?: {
    url: string;
    // rss-parser's type has this as a number but it is returning a string
    length?: string;
    type?: string;
  };
}
