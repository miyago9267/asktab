import { homedir } from "node:os";

/**
 * Browsers launch native messaging hosts with a bare PATH, and Bun snapshots
 * the environment at startup (mutating process.env does not affect
 * Bun.which/Bun.spawn). Every spawn and which must use these explicitly.
 */
export const AUGMENTED_PATH = [
  ...new Set([
    `${homedir()}/.local/bin`,
    `${homedir()}/.bun/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(":"),
  ]),
].join(":");

export const SPAWN_ENV: Record<string, string | undefined> = {
  ...process.env,
  PATH: AUGMENTED_PATH,
};
