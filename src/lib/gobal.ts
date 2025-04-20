import type { Location as LocationType } from "@/types";

export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace PrismaJson {
    type Location = LocationType;
  }
}
