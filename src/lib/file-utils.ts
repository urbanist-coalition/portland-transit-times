import fs from "fs";

export function exists(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.access(filePath,
      fs.constants.F_OK,
      (err) => {
        resolve(!err);
      });
  });
}

export function makeDirectory(dirPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdir(dirPath, { recursive: true }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function readFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf-8", (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export function writeFile(filePath: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, data, "utf-8", (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

