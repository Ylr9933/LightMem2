import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

async function main() {
  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "dist/index.js",
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    minify: false,
    logLevel: "info",
    logOverride: {
      // import.meta is used as an ESM fallback; __dirname is always available in CJS.
      "empty-import-meta": "silent",
    },
  });

  const workerSrc = join(
    process.cwd(),
    "..",
    "layers",
    "execution",
    "src",
    "composer",
    "reduction",
    "semantic-llmlingua2-worker.py",
  );
  const workerDest = join(process.cwd(), "dist", "semantic-llmlingua2-worker.py");
  await mkdir(dirname(workerDest), { recursive: true });
  await copyFile(workerSrc, workerDest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
