/**
 * @file What one screen has been told to do, which is all in its address.
 *
 * The boards hang on walls the agency owns and we cannot reach, and whoever can
 * reach the television is who configures it — there is nothing to log into and
 * no account to lose. What changed is where the settings live: everything is in
 * the URL the panel is pointed at, and nothing is stored in the browser.
 *
 * That is one source of truth instead of two, with no precedence to reason
 * about. It survives a power cycle, a nightly wipe of site data, a factory
 * reset and the hardware being swapped, because it is not in the television at
 * all. And it is composed somewhere with a keyboard: /tv/settings/ builds the
 * link on somebody's laptop and the only thing done at the screen is pasting it
 * in — which matters, because typing a sentence into a form with a remote
 * control is the worst part of running one of these.
 *
 * An expiry still works, which is the part that looks wrong at first glance:
 * the URL does not expire, but it carries the instant the message should stop,
 * and the board checks that against the clock on every pass. A television left
 * running past that time drops the message, and one rebooted a week later reads
 * the same address and shows nothing.
 *
 * Percent-encoded rather than packed into base64. It makes for a longer link —
 * a hundred-character message comes to about two hundred, nowhere near any
 * browser's limit — and in exchange somebody can read an address off a screen
 * and see what it says without decoding it first.
 */

/**
 * How loudly a message may be pitched: the same three the feed uses, so a typed
 * message is coloured by the rule that colours the agency's own.
 */
export const SEVERITIES = ["info", "warning", "severe"];

/**
 * What a message is when nobody chose. Warning rather than severe: reserving
 * the loudest colour for what the agency's feed itself calls severe is what
 * keeps that colour meaning something.
 */
export const SEVERITY_DEFAULT = "warning";

/** How many arrivals follow the big one when nobody has said otherwise. */
export const ROWS_DEFAULT = 2;

/**
 * The most that fit. Past this the hero has to shrink so far to make room that
 * the number stops being the thing you can read from the door, which is the
 * only reason the board exists.
 */
export const ROWS_MAX = 4;

/** Longer than this is not a board message, it is a paragraph. */
export const MESSAGE_MAX = 200;

/** A whole number of rows within range, or null if this is not one. */
export function parseRows(value) {
  if (value === null || value === undefined || value === "") return null;
  const rows = Number(value);
  if (!Number.isInteger(rows) || rows < 0 || rows > ROWS_MAX) return null;
  return rows;
}

/** An instant from the address, or null if it is missing or unreadable. */
function parseUntil(value) {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * Everything the address says, resolved against the clock.
 *
 * The message comes back shaped as an alert so it can be dropped straight in
 * beside the ones from the feed — the ticker already knows how to run several,
 * order them by severity and colour itself, and none of that has to learn that
 * one of them was typed by a person.
 *
 * Null once its time is up, decided here on every read rather than by anything
 * remembering to clear it. Nobody is watching this screen; the message has to
 * take itself down.
 */
export function readSettings(search, now = Date.now()) {
  const params = new URLSearchParams(search || "");
  const rows = parseRows(params.get("rows")) ?? ROWS_DEFAULT;

  const text = (params.get("msg") || "").trim().slice(0, MESSAGE_MAX);
  const until = parseUntil(params.get("until"));
  if (!text || (until !== null && now > until)) return { rows, message: null };

  const severity = params.get("sev");
  return {
    rows,
    message: {
      id: "tv-message",
      headerText: text,
      descriptionText: "",
      // Nothing scopes it: it was addressed to this screen, for this screen.
      informedEntity: [],
      activePeriod: [],
      severity: SEVERITIES.includes(severity) ? severity : SEVERITY_DEFAULT,
      effect: null,
      until,
    },
  };
}

/**
 * An instant as `<input type="datetime-local">` spells it: YYYY-MM-DDTHH:mm in
 * the browser's own local time.
 *
 * Built from the local parts rather than by slicing toISOString(), which is
 * UTC — that is the classic way this gets written, and it silently shifts the
 * time somebody typed by their offset from Greenwich. Four hours, here.
 */
export function toLocalInputValue(epochMs) {
  if (!Number.isFinite(epochMs)) return "";
  const at = new Date(epochMs);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/** The same, back again. Null for an empty or unparseable field. */
export function fromLocalInputValue(value) {
  if (!value) return null;
  // A date-time with no offset is local time by the language spec, which is
  // what the field means and what toLocalInputValue wrote.
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * The same instant, written for the address, carrying its offset.
 *
 * With the offset rather than as UTC or as a bare epoch, so somebody reading a
 * link can see the time the screen was actually set to — "18:00-04:00" is six
 * in the evening in Portland to anyone who looks, where "22:00Z" and
 * "1789329600" both have to be worked out first.
 */
export function toUrlInstant(epochMs) {
  if (!Number.isFinite(epochMs)) return "";
  const offset = -new Date(epochMs).getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return (
    `${toLocalInputValue(epochMs)}:00` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/**
 * The address to point a screen at.
 *
 * Only what differs from the default goes in, so a link says what somebody
 * chose rather than restating the defaults back at them — and a board with
 * nothing special about it gets a plain, memorable URL.
 */
export function buildBoardUrl(origin, settings) {
  const { stopCode, rows, message, severity, until } = settings || {};
  const code = (stopCode || "").trim().replace(/[^\w-]/g, "");
  if (!code) return "";

  const url = new URL(`/stops/${code}/tv/`, origin);
  if (parseRows(String(rows)) !== null && Number(rows) !== ROWS_DEFAULT) {
    url.searchParams.set("rows", String(rows));
  }

  const text = (message || "").trim().slice(0, MESSAGE_MAX);
  if (text) {
    url.searchParams.set("msg", text);
    if (severity && severity !== SEVERITY_DEFAULT) {
      url.searchParams.set("sev", severity);
    }
    if (Number.isFinite(until)) {
      url.searchParams.set("until", toUrlInstant(until));
    }
  }
  return url.toString();
}
