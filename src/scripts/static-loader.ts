// The purpose of this code is to see the warnings produced by loadStatic
//   This is useful for hardcoding stop name deduplications

import { GPMETRO } from "@/lib/constants";
import { loadStatic } from "@/lib/loaders/static";
import { RedisModel } from "@/lib/model";

async function main() {
  const model = new RedisModel();
  await loadStatic(GPMETRO, model);
}

main().catch(console.error);
