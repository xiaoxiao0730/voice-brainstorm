import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const outputDir = join(root, ".vercel", "output");
const staticDir = join(outputDir, "static");
const functionDir = join(outputDir, "functions", "__server.func");

await rm(outputDir, { recursive: true, force: true });
await mkdir(staticDir, { recursive: true });
await mkdir(functionDir, { recursive: true });

await cp(join(root, "dist", "client"), staticDir, { recursive: true });
await cp(join(root, "dist", "server"), functionDir, { recursive: true });

await writeFile(
  join(functionDir, ".vc-config.json"),
  JSON.stringify(
    {
      handler: "server.js",
      launcherType: "Nodejs",
      runtime: "nodejs22.x",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
    },
    null,
    2,
  ),
);

await writeFile(
  join(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/__server" }],
    },
    null,
    2,
  ),
);

console.log("Generated Vercel Build Output in .vercel/output");
