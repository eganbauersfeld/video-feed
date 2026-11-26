import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (fallback !== undefined && (e.code === "ENOENT" || e instanceof SyntaxError)) return structuredClone(fallback);
    throw e;
  }
}

export async function writeJson(path, data, { compact = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, (compact ? JSON.stringify(data) : JSON.stringify(data, null, 2)) + "\n");
}
