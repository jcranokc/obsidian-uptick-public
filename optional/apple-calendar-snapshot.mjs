

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

const transport = new StdioClientTransport({
  command: process.env.UVX ?? "uvx",
  args: ["apple-calendar-mcp"],
  env: { ...process.env, APPLE_CALENDAR_MCP_SAFETY_MODE: "safe_manage" },
});
const client = new Client({ name: "daily-action-calendar", version: "1.0.0" });
await client.connect(transport);
const health = await client.callTool({ name: "calendar_recheck_permissions", arguments: {} });
const calendars = await client.callTool({ name: "calendar_list_calendars", arguments: {} });
const readText = (result) => (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
console.log(JSON.stringify({ health: JSON.parse(readText(health)), calendars: JSON.parse(readText(calendars)) }));
await transport.close();
