import * as fs from "node:fs/promises";

let CACHED_KEY: object | undefined = undefined;

export const ensureKey = async () => {
  if (!CACHED_KEY) CACHED_KEY = await loadKey();
  return CACHED_KEY;
};

const loadKey = async () => {
  const jwk = await fs.readFile("jwk.public.json", { encoding: "utf-8" });
  return JSON.parse(jwk);
};
