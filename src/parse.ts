import { readFileSync } from 'fs';
import { resolve } from 'path';

import Ajv, { JSONSchemaType } from 'ajv';


// Represents a geographical location with latitude, longitude, and heading.
interface Location {
  lat: number; // Latitude
  lng: number; // Longitude
  cap: number; // Heading (in degrees)
}

// Represents a segment or section of a route.
interface Segment {
  debut: Location; // Starting location of the segment
  fin: Location; // Ending location of the segment
  idTroncon: number; // Segment ID
}

// Represents an itinerary consisting of multiple segments.
interface Itinerary {
  troncons: Segment[]; // List of segments
}

// Represents information about a transit line.
interface LineInfo {
  idLigne: number; // Line ID
  estPad: boolean; // Indicates whether it is a PAD (possibly a specific type of line or feature)
}

// Represents a transit line with its details.
interface Line {
  nomCommercial: string; // Non-commercial name of the line
  libCommercial: string; // Commercial name of the line
  mnemo: string; // Mnemonic or short identifier for the line
  couleur: string; // Color associated with the line
  itineraire: Itinerary[]; // List of itineraries
  messageIVExiste: boolean; // Indicates whether a message exists (IV could be a specific system feature)
  idLigne: number; // Line ID
}

// Represents a transit stop or point of interest.
interface Stop {
  nomCommercial: string; // Commercial name of the stop
  stopCode: string; // Code associated with the stop
  infoLigneSwiv: LineInfo[]; // Information about lines associated with the stop
  localisation: Location; // Geographical location of the stop
  idPointArret: number; // Stop ID
  mnemoPointArret: string; // Mnemonic or short identifier for the stop
}

// Represents a detour or route deviation.
interface Deviation {
  troncons: Segment[]; // List of segments affected by the deviation
}

// Represents the topological data of a transit system.
interface Topography {
  ligne: Line[]; // List of transit lines
  pointArret: Stop[]; // List of stops
  deviation: Deviation[]; // List of route deviations
  libelleCE: string; // Labels or descriptions (exact meaning of "CE" depends on context)
}

// Represents the response for a request for stops and related information.
interface StopsResponse {
  topo: [Topography]; // Topological data
}

const locationSchema: JSONSchemaType<Location> = {
  "type": "object",
  "properties": {
    "lat": { "type": "number" },
    "lng": { "type": "number" },
    "cap": { "type": "number" }
  },
  "required": ["lat", "lng", "cap"],
  "additionalProperties": false
};

const segmentSchema: JSONSchemaType<Segment> = {
  "type": "object",
  "properties": {
    "debut": locationSchema,
    "fin": locationSchema,
    "idTroncon": { "type": "number" }
  },
  "required": ["debut", "fin", "idTroncon"],
  "additionalProperties": false
};


const lineInfoSchema: JSONSchemaType<LineInfo> = {
  "type": "object",
  "properties": {
    "idLigne": { "type": "number" },
    "estPad": { "type": "boolean" }
  },
  "required": ["idLigne", "estPad"],
  "additionalProperties": false
};

const schema: JSONSchemaType<StopsResponse> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "topo": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1,
      "items": [{
        "type": "object",
        "properties": {
          "ligne": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "nomCommercial": { "type": "string" },
                "libCommercial": { "type": "string" },
                "mnemo": { "type": "string" },
                "couleur": { "type": "string" },
                "itineraire": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "troncons": {
                        "type": "array",
                        "items": segmentSchema,
                      }
                    },
                    "required": ["troncons"],
                    "additionalProperties": false
                  }
                },
                "messageIVExiste": { "type": "boolean" },
                "idLigne": { "type": "number" }
              },
              "required": ["nomCommercial", "libCommercial", "mnemo", "couleur", "itineraire", "messageIVExiste", "idLigne"],
              "additionalProperties": false
            }
          },
          "pointArret": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "nomCommercial": { "type": "string" },
                "stopCode": { "type": "string" },
                "infoLigneSwiv": {
                  "type": "array",
                  "items": lineInfoSchema
                },
                "localisation": locationSchema,
                "idPointArret": { "type": "number" },
                "mnemoPointArret": { "type": "string" }
              },
              "required": ["nomCommercial", "stopCode", "infoLigneSwiv", "localisation", "idPointArret", "mnemoPointArret"],
              "additionalProperties": false
            }
          },
          "deviation": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "troncons": {
                  "type": "array",
                  "items": segmentSchema,
                }
              },
              "required": ["troncons"],
              "additionalProperties": false
            }
          },
          "libelleCE": {
            "type": "string",
          }
        },
        "required": ["ligne", "pointArret", "deviation", "libelleCE"],
        "additionalProperties": false
      }]
    }
  },
  "required": ["topo"],
  "additionalProperties": false
}



// prints type, if object prints type of each key
// function keyTypePrint(t: unknown) {
//   const type = typeof t;
// 
//   if (type === 'object') {
//     for (const key in t) {
//       console.log(key, '-', typeof t[key]);
//     }
//   } else {
//     console.log(type);
//   }
// }

async function main() {
  const stopsPath = resolve(__dirname, '..', 'stops.json');
  const stopsData = readFileSync(stopsPath, 'utf8');
  const stopsDataParsed = JSON.parse(stopsData) as StopsResponse;

  console.log(stopsDataParsed.topo[0].libelleCE)


  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const valid = validate(stopsDataParsed);

  console.log(valid);

  if (!valid) {
    console.log(validate.errors);
  }

  const stopsByStopCode = new Map<string, Stop>();

  let stopCode: string;
  for (const stop of stopsDataParsed.topo[0].pointArret) {
    stopsByStopCode.set(stop.stopCode, stop);
    stopCode = stop.stopCode;
  }

  console.log(stopCode, stopsByStopCode.get(stopCode));

}

main();
