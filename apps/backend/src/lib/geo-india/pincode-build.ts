import { MedusaError } from "@medusajs/framework/utils";
import { STATES } from "./states";

export type CsvRow = Record<string, string>;

/** [state ISO code, district, up to five office names] */
export type PinEntry = [string, string, string[]];

export type PinDirectory = {
  generated_at: string;
  source: string;
  count: number;
  pins: Record<string, PinEntry>;
};

export type BuildResult = {
  directory: PinDirectory;
  rows_read: number;
  rows_skipped: number;
  conflicts: number;
};

export const DIRECTORY_SOURCE =
  "All India Pincode Directory, data.gov.in, Government Open Data Licence India (GODL)";

export const MAX_OFFICES_PER_PIN = 5;

// Column names of the downloaded file, lower-case. Change only here when the header differs.
export const COLUMNS = {
  pin: "pincode",
  office: "officename",
  officeType: "officetype",
  district: "district",
  state: "statename",
} as const;

const PIN_PATTERN = /^[1-9][0-9]{5}$/;

/** Reads quoted fields with commas and doubled quotes, CRLF or LF, and a trailing newline. */
export function parseCsv(text: string): CsvRow[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    if (!(record.length === 1 && record[0] === "")) {
      records.push(record);
    }
    record = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === "\"") {
        if (source[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === "\"") {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r") {
      if (source[i + 1] === "\n") {
        i += 1;
      }
      endRecord();
    } else if (ch === "\n") {
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    endRecord();
  }

  if (records.length === 0) {
    return [];
  }
  const header = records[0].map((h) => h.trim().toLowerCase());
  return records.slice(1).map((values) => {
    const row: CsvRow = {};
    header.forEach((name, index) => {
      row[name] = (values[index] ?? "").trim();
    });
    return row;
  });
}

// Spellings that are not the table's own name. Targets are ISO codes of the state table.
const ALIASES: Record<string, string> = {
  ORISSA: "IN-OD",
  UTTARANCHAL: "IN-UT",
  PONDICHERRY: "IN-PY",
  "NCT OF DELHI": "IN-DL",
  "DADRA AND NAGAR HAVELI": "IN-DH",
  "DAMAN AND DIU": "IN-DH",
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "IN-DH",
  "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "IN-DH",
};

// Misspellings that resolve through the table's own name, so no code is repeated here.
const NAME_ALIASES: Record<string, string> = {
  CHATTISGARH: "CHHATTISGARH",
  CHHATISGARH: "CHHATTISGARH",
};

const TABLE_CODES = new Set(STATES.map((s) => s.code));
const BY_NAME = new Map(STATES.map((s) => [s.name.toUpperCase(), s.code]));

for (const code of Object.values(ALIASES)) {
  if (!TABLE_CODES.has(code)) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `[pincode-build] Alias target ${code} is not in the state table.`
    );
  }
}

/** Maps a state name from the directory to an ISO code. Never guesses: an unknown name throws. */
export function normalizeStateName(name: string): string {
  const key = name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\s+/g, " ")
    .trim();
  const code = ALIASES[key] ?? BY_NAME.get(NAME_ALIASES[key] ?? key);
  if (!code) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `[pincode-build] Unmapped state name "${name}". Add it to the alias table.`
    );
  }
  return code;
}

export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s\-/(.])([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

const OFFICE_SUFFIX = /\s+(B\.?\s?O|S\.?\s?O|H\.?\s?O)\.?\s*$/i;

/** Removes a trailing B.O, S.O, H.O, BO, SO or HO. */
export function stripOfficeSuffix(name: string): string {
  return name.replace(OFFICE_SUFFIX, "").trim();
}

// Head office first, then sub office, then branch office.
function officeRank(row: CsvRow): number {
  const kind = (row[COLUMNS.officeType] ?? "").trim().toUpperCase();
  const fromSuffix = (OFFICE_SUFFIX.exec(row[COLUMNS.office] ?? "")?.[1] ?? "").replace(/[.\s]/g, "").toUpperCase();
  const letter = (kind || fromSuffix).charAt(0);
  if (letter === "H") {
    return 0;
  }
  if (letter === "S") {
    return 1;
  }
  return 2;
}

type Accumulator = {
  states: Map<string, number>;
  districts: Map<string, string>;
  offices: Map<string, { name: string; rank: number }>;
};

export function buildDirectory(rows: CsvRow[], generatedAt: string): BuildResult {
  const perPin = new Map<string, Accumulator>();
  let skipped = 0;

  for (const row of rows) {
    const pin = (row[COLUMNS.pin] ?? "").trim();
    if (!PIN_PATTERN.test(pin)) {
      skipped += 1;
      continue;
    }
    const state = normalizeStateName(row[COLUMNS.state] ?? "");
    let acc = perPin.get(pin);
    if (!acc) {
      acc = { states: new Map(), districts: new Map(), offices: new Map() };
      perPin.set(pin, acc);
    }
    acc.states.set(state, (acc.states.get(state) ?? 0) + 1);
    if (!acc.districts.has(state)) {
      acc.districts.set(state, titleCase((row[COLUMNS.district] ?? "").trim()));
    }
    const office = titleCase(stripOfficeSuffix(row[COLUMNS.office] ?? ""));
    if (office !== "") {
      const key = office.toLowerCase();
      const rank = officeRank(row);
      const known = acc.offices.get(key);
      if (!known || rank < known.rank) {
        acc.offices.set(key, { name: office, rank });
      }
    }
  }

  let conflicts = 0;
  const pins: Record<string, PinEntry> = {};
  for (const pin of [...perPin.keys()].sort()) {
    const acc = perPin.get(pin) as Accumulator;
    if (acc.states.size > 1) {
      conflicts += 1;
    }
    // Majority wins; a tie goes to the lower ISO code so the output is stable.
    const winner = [...acc.states.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0][0];
    const offices = [...acc.offices.values()]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, MAX_OFFICES_PER_PIN)
      .map((o) => o.name);
    pins[pin] = [winner, acc.districts.get(winner) ?? "", offices];
  }

  return {
    directory: {
      generated_at: generatedAt,
      source: DIRECTORY_SOURCE,
      count: Object.keys(pins).length,
      pins,
    },
    rows_read: rows.length,
    rows_skipped: skipped,
    conflicts,
  };
}
