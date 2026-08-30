/* Recent Apple Mail messages WITH their body text.
 *
 * apple-mail-recent.mjs returns search results only, and mail_search_messages
 * leaves `preview` empty for most messages — which made every generated summary
 * collapse to the subject line. This fetches each message so the importer has
 * real text to summarise.
 *
 * The body is returned to the caller for analysis and is NOT written to the
 * vault; email-import.py stores only the derived summary and action items.
 *
 * Read-only: safe_readonly profile, so nothing is sent, moved, or marked read.
 * Each get is individually guarded — one slow message must not lose the batch.
 */

/* The MCP SDK is not vendored here. Point MCP_HOME at an install that has
 * @modelcontextprotocol/sdk under node_modules.
 *
 * These are dynamic imports because a static one takes a literal string --
 * a "${...}" placeholder inside those quotes is not interpolated, it is just
 * part of a path that does not exist, and the script dies at load with a
 * module-not-found error naming the placeholder itself. */
const MCP_HOME = process.env.MCP_HOME;
if (!MCP_HOME) {
  console.log(JSON.stringify({
    error: "set MCP_HOME to a directory containing "
         + "node_modules/@modelcontextprotocol/sdk",
  }));
  process.exit(2);
}
const SDK = `${MCP_HOME}/node_modules/@modelcontextprotocol/sdk/dist/esm/client`;
const { Client } = await import(`${SDK}/index.js`);
const { StdioClientTransport } = await import(`${SDK}/stdio.js`);

const HOURS = Number(process.env.MAIL_HOURS || 24);
const MAX_DETAIL = Number(process.env.MAIL_MAX_DETAIL || 40);
/* Mail answers AppleScript unreliably under a fast sequential loop. */
const BODY_ATTEMPTS = Number(process.env.MAIL_BODY_ATTEMPTS || 3);
const BODY_RETRY_MS = Number(process.env.MAIL_BODY_RETRY_MS || 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const transport = new StdioClientTransport({
  command: process.env.UVX ?? "uvx",
  args: ["apple-mcp-mail"],
  env: { ...process.env, APPLE_MAIL_MCP_SAFETY_PROFILE: "safe_readonly" },
});
const client = new Client({ name: "life-os-mail-detail", version: "1.0.0" });
await client.connect(transport);

const text = (r) =>
  (r?.content ?? []).filter((i) => i.type === "text").map((i) => i.text).join("\n");

const search = await client.callTool({
  name: "mail_search_messages",
  arguments: { query: "*", limit: 100 },
});
const payload = JSON.parse(text(search));

const cutoff = Date.now() - HOURS * 60 * 60 * 1000;
const recent = (payload.results ?? []).filter((item) => {
  const raw = String(item.date_received ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+at\s+/i, " ");
  const ts = Date.parse(raw);
  return !Number.isNaN(ts) && ts >= cutoff;
});

const out = [];
let fetched = 0;
let failed = 0;
let degraded = 0;

for (const item of recent.slice(0, MAX_DETAIL)) {
  const record = { ...item, body: "", body_source: "none" };
  const id = String(item.message_id ?? "");
  if (id) {
    /* Mail returns an empty body for a message it will happily return in full
     * a moment later -- the same message came back 0 bytes on one call and
     * 1596 on the next. Asking once and believing the answer meant the
     * importer judged half the inbox on subject lines alone.
     *
     * Retry with a widening pause. `preview` is only accepted after the
     * retries are spent, because it is usually the subject echoed back and
     * accepting it early hides the failure. */
    let real = "";
    let preview = "";
    for (let attempt = 0; attempt < BODY_ATTEMPTS && !real.trim(); attempt++) {
      if (attempt) await sleep(BODY_RETRY_MS * attempt);
      try {
        const detail = await client.callTool({
          name: "mail_get_message",
          arguments: { message_id: id },
        });
        const parsed = JSON.parse(text(detail));
        const msg = parsed.result ?? parsed;
        real = String(msg.body_text ?? msg.body ?? "");
        preview = preview || String(msg.preview ?? "");
      } catch (e) {
        /* One unreadable message should not abandon the rest. */
        record.body_source = "error";
      }
    }
    if (real.trim()) {
      record.body = real;
      record.body_source = "body";
      fetched += 1;
    } else if (record.body_source === "error") {
      failed += 1;
    } else {
      record.body = preview;
      record.body_source = preview.trim() ? "preview" : "none";
      degraded += 1;
    }
  }
  out.push(record);
}

/* Exchange delivers the same message more than once -- two copies of one
 * provisioning notice arrived four seconds apart, same sender, same subject,
 * same attachments -- and Mail will extract a body from one copy and return
 * nothing for the other. Where a twin read cleanly, lend its body to the copy
 * that did not, rather than reporting a message nobody can read.
 *
 * Keyed on sender and subject only. Two genuinely different messages that share
 * both are already indistinguishable to a reader skimming a list. */
let borrowed = 0;
const bySubject = new Map();
for (const r of out) {
  if (r.body_source !== "body") continue;
  const key = `${r.sender ?? ""}\u0000${r.subject ?? ""}`;
  if (!bySubject.has(key)) bySubject.set(key, r.body);
}
for (const r of out) {
  if (r.body_source === "body") continue;
  const twin = bySubject.get(`${r.sender ?? ""}\u0000${r.subject ?? ""}`);
  if (twin) {
    r.body = twin;
    r.body_source = "twin";
    borrowed += 1;
    degraded -= 1;
  }
}

console.log(JSON.stringify({
  count: out.length,
  bodies_borrowed: borrowed,
  bodies_fetched: fetched,
  bodies_degraded: degraded,
  bodies_failed: failed,
  results: out,
}));
await transport.close();
