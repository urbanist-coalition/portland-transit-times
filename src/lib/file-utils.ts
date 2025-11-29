"server only";

import fs from "fs";
import path from "path";

function absolutePath(name: string): string {
  return path.join(process.cwd(), name);
}

function exists(pathname: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.access(pathname, fs.constants.F_OK, (err) => {
      if (err) return resolve(false);
      resolve(true);
    });
  });
}

async function mkdirIfNotExists(pathname: string): Promise<string> {
  if (!(await exists(pathname))) {
    await new Promise<void>((resolve, reject) => {
      fs.mkdir(pathname, { recursive: true }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  return pathname;
}

export async function writeJSON(name: string, data: object): Promise<void> {
  const pathname = absolutePath(name);
  await mkdirIfNotExists(path.dirname(pathname));
  await new Promise<void>((resolve, reject) => {
    fs.writeFile(pathname, JSON.stringify(data, null, 2), (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function readFile(name: string): Promise<string> {
  const pathname = absolutePath(name);
  return new Promise<string>((resolve, reject) => {
    fs.readFile(pathname, "utf8", (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export async function readJSON<T>(
  name: string,
  defaultValue: T | undefined = undefined
): Promise<T> {
  const pathname = absolutePath(name);
  if (!(await exists(pathname))) {
    if (defaultValue === undefined)
      throw new Error(`File not found: ${pathname}`);
    return defaultValue;
  }

  return new Promise<T>((resolve, reject) => {
    fs.readFile(pathname, "utf8", (err, data) => {
      if (err) return reject(err);
      resolve(JSON.parse(data));
    });
  });
}
