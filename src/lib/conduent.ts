import Ajv, { JSONSchemaType } from 'ajv';

async function conduentFetch<T>(path: string, schema: JSONSchemaType<T>): Promise<T> {
  const baseUrl = 'https://swiv.gptd.cadavl.com/SWIV/GPTD/proxy/restWS';
  const now = Date.now();
  const response = await fetch(`${baseUrl}/${path}?_tmp=${now}`, {
    "credentials": "omit",
    "headers": {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.5",
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-GPC": "1"
    },
    "referrer": "https://swiv.gptd.cadavl.com/SWIV/GPTD",
    "method": "GET",
    "mode": "cors"
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    console.error(validate.errors);
    throw new Error("Invalid data");
  }
  return data;
}

// Represents a specific schedule entry with its state and timing.
interface Horaire {
  idHoraire: number;          // schedule ID
  etatHoraire: number;        // schedule state (e.g., active, inactive)
  etatPassage: number;        // passage state (e.g., on-time, delayed)
  horaire: number;            // predicted time in seconds from midnight
  horaireApplicable: number;  // scheduled time in seconds from midnight
}

// Represents a destination, which includes one or more schedules (horaires).
interface Destination {
  libelle: string;            // label for the destination
  libelleHexa: string;        // hexadecimal-encoded label
  existeSuivant: boolean;     // indicates if a next schedule (following run) exists
  existePrecedent: boolean;   // indicates if a previous schedule (preceding run) exists
  modeManu: boolean;          // indicates if manual mode is enabled
  horaires: Horaire[];        // list of schedule entries for this destination
}

// Represents the line schedule entry that associates a line (idLigne) with destinations and their schedules.
interface LigneHoraire {
  idLigne: number;            // line ID
  destination: Destination[]; // array of destinations for this line
}

// Represents the entire response containing a list of line schedules.
interface ListeHorairesResponse {
  listeHoraires: LigneHoraire[]; // list of line schedules
}

const listeHorairesSchema: JSONSchemaType<ListeHorairesResponse> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "listeHoraires": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "idLigne": { "type": "number" },
          "destination": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "libelle": { "type": "string" },
                "libelleHexa": { "type": "string" },
                "existeSuivant": { "type": "boolean" },
                "existePrecedent": { "type": "boolean" },
                "modeManu": { "type": "boolean" },
                "horaires": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "idHoraire": { "type": "number" },
                      "etatHoraire": { "type": "number" },
                      "etatPassage": { "type": "number" },
                      "horaire": { "type": "number" },
                      "horaireApplicable": { "type": "number" }
                    },
                    "required": ["idHoraire", "etatHoraire", "etatPassage", "horaire", "horaireApplicable"],
                    "additionalProperties": false
                  }
                }
              },
              "required": ["libelle", "libelleHexa", "existeSuivant", "existePrecedent", "modeManu", "horaires"],
              "additionalProperties": false
            }
          }
        },
        "required": ["idLigne", "destination"],
        "additionalProperties": false
      }
    }
  },
  "required": ["listeHoraires"],
  "additionalProperties": false
};

export async function stopPredictions(stopId: number): Promise<ListeHorairesResponse> {
  return conduentFetch(`horaires/pta/${stopId}`, listeHorairesSchema);
}

// Represents a geographical location with latitude, longitude, and heading.
export interface Location {
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
export interface Stop {
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
interface TopographyResponse {
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

const schema: JSONSchemaType<TopographyResponse> = {
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


export async function topography(): Promise<TopographyResponse> {
  return conduentFetch('topo', schema);
}
