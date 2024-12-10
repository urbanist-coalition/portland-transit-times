import Ajv, { JSONSchemaType } from "ajv";

// Represents a specific schedule entry with its state and timing.
interface Horaire {
  idHoraire: number;          // schedule ID
  etatHoraire: number;        // schedule state (e.g., active, inactive)
  etatPassage: number;        // passage state (e.g., on-time, delayed)
  horaire: number;            // scheduled time (likely in seconds/minutes from a reference)
  horaireApplicable: number;  // applicable time (the effective time used)
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
  const response = await fetch(`https://swiv.gptd.cadavl.com/SWIV/GPTD/proxy/restWS/horaires/pta/${stopId}?_tmp=${Date.now()}`, {
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
  const validate = ajv.compile(listeHorairesSchema);
  const valid = validate(data);
  if (!valid) {
    console.error(validate.errors);
    throw new Error("Invalid data");
  }
  return data;
}

