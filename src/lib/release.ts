/**
 * @file Releases: what a build produces, and how it becomes the live one.
 *
 * A release is a directory that either exists completely or does not exist at
 * all. It holds everything derived from one feed — the pages, the map, the
 * schedule the worker reads — so the app and the map can never be built from
 * different readings of the world.
 *
 *   <releases>/<id>/site/          pages
 *   <releases>/<id>/tiles/         the map bundle
 *   <releases>/<id>/static.json    the normalised feed
 *   <releases>/<id>/manifest.json  what went into it
 *   <releases>/<id>/data           -> ../../_data/<id>
 *   <releases>/current             -> <id>
 *   <data>/<id>/                   arrivals, vehicles, alerts
 *
 * The data directory is a sibling of the releases directory, and the release
 * points at it with a *relative* symlink, so the same tree resolves on the host
 * and inside a container that mounts the two as siblings. It is separate
 * because it is rewritten every few seconds and belongs in RAM; it is named for
 * the build because a page from one release must never poll another's arrivals.
 *
 * Becoming current is a rename, not a rewrite: `mv -T` over the symlink is
 * atomic, so a reader sees the old release or the new one and never a mixture.
 */

import {
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

/** How many past releases stay on disk, so a rollback has somewhere to go. */
const KEEP = 3;

export interface Manifest {
  /** ETag of the feed this was built from. */
  feedHash: string | undefined;
  /** The commit that built it — a template change is a new release too. */
  appVersion: string;
  builtAt: string;
}

export class Releases {
  constructor(
    /** Holds the release directories and the `current` symlink. */
    readonly releasesDir: string,
    /** Sibling of the above, holding one live data directory per release. */
    readonly dataDir: string
  ) {}

  path(id: string): string {
    return join(this.releasesDir, id);
  }

  staging(id: string): string {
    return join(this.releasesDir, `${id}.partial`);
  }

  get currentLink(): string {
    return join(this.releasesDir, "current");
  }

  /** The id of the live release, or null if there is not one yet. */
  async current(): Promise<string | null> {
    try {
      return basename(await readlink(this.currentLink));
    } catch {
      return null;
    }
  }

  async manifest(id: string): Promise<Manifest | null> {
    try {
      const { readFile } = await import("node:fs/promises");
      return JSON.parse(
        await readFile(join(this.path(id), "manifest.json"), "utf8")
      );
    } catch {
      return null;
    }
  }

  /** Prepares an empty staging directory, discarding any half-built attempt. */
  async stage(id: string): Promise<string> {
    const staging = this.staging(id);
    await rm(staging, { recursive: true, force: true });
    await mkdir(join(staging, "site"), { recursive: true });
    await mkdir(join(staging, "tiles"), { recursive: true });
    await mkdir(join(this.dataDir, id), { recursive: true });

    // Relative, so the same link resolves wherever the pair is mounted.
    await symlink(
      join("..", "..", basename(this.dataDir), id),
      join(staging, "data")
    );
    return staging;
  }

  async writeManifest(staging: string, manifest: Manifest): Promise<void> {
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );
  }

  /**
   * Makes a staged build the live one.
   *
   * The staging directory is renamed first, so a release directory only ever
   * exists complete; then the symlink is replaced by renaming a new one over
   * it, which is atomic. `ln -sfn` would unlink before it links, leaving a
   * moment with no site at all.
   */
  async publish(id: string): Promise<void> {
    await rename(this.staging(id), this.path(id));

    const pending = `${this.currentLink}.new`;
    await rm(pending, { force: true });
    await symlink(id, pending);
    await rename(pending, this.currentLink);
  }

  /** Drops all but the newest few releases, and their data directories. */
  async prune(keep = KEEP): Promise<string[]> {
    const current = await this.current();
    const entries = await readdir(this.releasesDir, { withFileTypes: true });
    const releases = entries
      .filter(
        (entry) => entry.isDirectory() && !entry.name.endsWith(".partial")
      )
      .map((entry) => entry.name)
      .sort();

    const doomed = releases
      .filter((id) => id !== current)
      .slice(0, Math.max(0, releases.length - keep));

    for (const id of doomed) {
      await rm(this.path(id), { recursive: true, force: true });
      await rm(join(this.dataDir, id), { recursive: true, force: true });
    }
    return doomed;
  }
}
