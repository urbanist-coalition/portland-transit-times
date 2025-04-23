import type { Location as LocationType } from "@/lib/model";

export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace PrismaJson {
    type Location = LocationType;
  }
}
