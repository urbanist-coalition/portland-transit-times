export interface Location {
  lat: number;
  lng: number;
  cap?: number;
}

export interface LineData {
  lineId: number;
  lineName: string;
  lineColor: string;
  points: Location[][];
}

export interface StopData {
  stopId: number;
  stopName: string;
  stopCode: string;
  location: Location;
  lineIds: number[];
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
    length?: number;
    type?: string;
  };
}
