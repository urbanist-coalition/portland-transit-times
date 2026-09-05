/**
 * @file Which stops have a panel on them.
 *
 * An allowlist rather than every stop, because a frame is 48 KB and there are
 * 656 stops: rendering them all would put 30 MB of bitmaps into every release
 * and 656 renders a minute into the worker, to serve a handful of panels. The
 * one-shot renderer takes any stop code, so a stop can be looked at before it
 * is ever added here.
 *
 * A JSON file rather than an environment variable because the site build will
 * want to read the same list, and because which stops have hardware on them is
 * a fact about the world worth having in the history.
 */

import { readFileSync } from "node:fs";

import { DisplayProfile, PROFILES } from "./profile";

export interface Installation {
  stopCode: string;
  profile: DisplayProfile;
}

const PATH = process.env.DISPLAYS_FILE ?? "displays.json";

export function installations(path = PATH): Installation[] {
  let parsed: { installations?: { stopCode: string; device: string }[] };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // No panels configured is a normal deployment, not a broken one.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return (parsed.installations ?? []).map(({ stopCode, device }) => {
    const profile = PROFILES[device];
    if (!profile) {
      throw new Error(
        `${path}: stop ${stopCode} names unknown device ${device}`
      );
    }
    return { stopCode, profile };
  });
}
