// Stand-in for the NVD API and the CISA KEV feed. Serves recorded fixtures only.
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, "../fixtures", name));
const port = Number(process.env.MOCK_NVD_PORT ?? 54331);

http
  .createServer((req, res) => {
    const url = req.url ?? "";
    let body = null;
    if (url.startsWith("/rest/json/cpes/2.0")) body = fixture("cpes_xbox.json");
    else if (url.startsWith("/rest/json/cves/2.0")) body = fixture("cves_xbox.json");
    else if (url.startsWith("/kev")) body = fixture("kev.json");
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    res.end(body ?? "{}");
  })
  .listen(port, "127.0.0.1");
