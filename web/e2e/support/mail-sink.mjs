// A tiny SMTP server on loopback for the e2e run. It keeps every accepted mail in memory
// and serves them as JSON on a second port: GET /messages?to=<address>, DELETE /messages.
// No TLS and no AUTH: the worker runs with SMTP_TLS=off.
import http from "node:http";
import net from "node:net";

const smtpPort = Number(process.env.MAIL_SINK_SMTP_PORT ?? 54332);
const httpPort = Number(process.env.MAIL_SINK_HTTP_PORT ?? 54333);
const messages = [];

function decodeQuotedPrintable(text) {
  const joined = text.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i]));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function parse(raw, to) {
  const split = raw.search(/\r?\n\r?\n/);
  const head = split === -1 ? raw : raw.slice(0, split);
  let body = split === -1 ? "" : raw.slice(split).replace(/^\r?\n\r?\n/, "");
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
  }
  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (encoding === "quoted-printable") body = decodeQuotedPrintable(body);
  if (encoding === "base64")
    body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return { to, subject: headers.subject ?? "", headers, body };
}

net
  .createServer((socket) => {
    let buffer = "";
    let inData = false;
    let data = "";
    const recipients = [];
    const say = (line) => socket.write(`${line}\r\n`);
    say("220 mail-sink ready");
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            const raw = data;
            data = "";
            for (const to of recipients) messages.push(parse(raw, to));
            recipients.length = 0;
            say("250 queued");
          } else {
            data += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO" || command === "HELO") say("250 mail-sink");
        else if (command === "MAIL") say("250 ok");
        else if (command === "RCPT") {
          recipients.push((line.match(/<([^>]*)>/)?.[1] ?? "").toLowerCase());
          say("250 ok");
        } else if (command === "DATA") {
          inData = true;
          say("354 go ahead");
        } else if (command === "RSET" || command === "NOOP") say("250 ok");
        else if (command === "QUIT") {
          say("221 bye");
          socket.end();
        } else say("502 not supported");
      }
    });
  })
  .listen(smtpPort, "127.0.0.1");

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/messages") {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "DELETE") {
      messages.length = 0;
      res.writeHead(204).end();
      return;
    }
    const to = url.searchParams.get("to")?.toLowerCase();
    const found = to ? messages.filter((m) => m.to === to) : messages;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(found));
  })
  .listen(httpPort, "127.0.0.1");
