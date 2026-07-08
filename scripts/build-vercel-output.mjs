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
      handler: "index.mjs",
      launcherType: "Nodejs",
      runtime: "nodejs22.x",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
    },
    null,
    2,
  ),
);

await writeFile(join(functionDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));

await writeFile(
  join(functionDir, "index.mjs"),
  `import server from "./server.js";

function toWebHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export default async function handler(req, res) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", protocol + "://" + host);
  const body = await readBody(req);
  const request = new Request(url, {
    method: req.method || "GET",
    headers: toWebHeaders(req.headers),
    body,
    ...(body ? { duplex: "half" } : {}),
  });

  const response = await server.fetch(request, process.env, {
    waitUntil: () => undefined,
  });

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}
`,
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
