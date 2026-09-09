/**
 * @file The link builder — site/tv-settings.njk.
 *
 * It writes nothing anywhere. Every field feeds one address, and that address
 * is the entire configuration of a screen: point a television at it and it is
 * set up; point it at a different one and it is set up differently.
 *
 * Which means this page does not have to be opened on the television. It is
 * meant to be used on a laptop, where there is a keyboard, and the only thing
 * done at the screen is pasting in what comes out.
 */

import {
  MESSAGE_MAX,
  ROWS_DEFAULT,
  buildBoardUrl,
  fromLocalInputValue,
  toLocalInputValue,
} from "/js/tv-settings.js";

const rowsField = document.getElementById("rows");
const messageField = document.getElementById("message");
const severityField = document.getElementById("severity");
const untilField = document.getElementById("until");
const durationField = document.getElementById("duration");
const stopField = document.getElementById("stop");
const output = document.getElementById("board-url");
const openLink = document.getElementById("open-board");
const copyButton = document.getElementById("copy-url");
const copyStatus = document.getElementById("copy-status");

const HOUR_MS = 3_600_000;

function currentUrl() {
  return buildBoardUrl(window.location.origin, {
    stopCode: stopField?.value,
    rows: rowsField?.value ?? ROWS_DEFAULT,
    message: messageField?.value,
    severity: severityField?.value,
    until: fromLocalInputValue(untilField?.value),
  });
}

function refresh() {
  const url = currentUrl();

  if (output) {
    output.textContent = url || "Enter a stop number to build the address.";
  }
  if (openLink) {
    // Not a disabled link: an anchor with no href is neither focusable nor
    // announced, which is the honest state when there is nothing to open.
    if (url) openLink.href = url;
    else openLink.removeAttribute("href");
  }

  // Said here rather than left for somebody to discover at the screen, where
  // the message would simply not appear and would look like a bug.
  const until = fromLocalInputValue(untilField?.value);
  if (copyStatus) {
    copyStatus.textContent =
      messageField?.value.trim() && until !== null && until <= Date.now()
        ? "That time has already passed, so this link shows no message."
        : "";
  }
}

/*
 * The dropdown is a shortcut, not a setting: it writes into the date field and
 * then resets itself, so nothing on screen claims to be the expiry except the
 * expiry.
 */
durationField?.addEventListener("change", () => {
  const choice = durationField.value;
  if (!choice) return;

  if (untilField) {
    untilField.value =
      choice === "none"
        ? ""
        : toLocalInputValue(Date.now() + Number(choice) * HOUR_MS);
  }
  durationField.value = "";
  refresh();
});

copyButton?.addEventListener("click", async () => {
  const url = currentUrl();
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    if (copyStatus) copyStatus.textContent = "Address copied.";
  } catch {
    // The clipboard needs a secure context and a permission that is not always
    // given. The address is on screen either way, so say so rather than
    // appearing to have done nothing.
    if (copyStatus) {
      copyStatus.textContent = "Could not copy — select the address above.";
    }
  }
});

for (const field of [
  rowsField,
  messageField,
  severityField,
  untilField,
  stopField,
]) {
  field?.addEventListener("input", refresh);
  field?.addEventListener("change", refresh);
}

if (messageField) messageField.maxLength = MESSAGE_MAX;
refresh();
