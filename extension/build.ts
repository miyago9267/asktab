import { cp } from "node:fs/promises";

const root = import.meta.dir;

const result = await Bun.build({
  entrypoints: [`${root}/src/popup.ts`],
  outdir: `${root}/dist`,
  target: "browser",
  format: "iife",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await cp(`${root}/public`, `${root}/dist`, { recursive: true });
await cp(
  `${root}/node_modules/highlight.js/styles/github-dark.min.css`,
  `${root}/dist/hljs.css`,
);

console.log("built extension/dist");
