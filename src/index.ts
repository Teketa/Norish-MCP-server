#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NorishClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

try {
  const server = createServer(new NorishClient(loadConfig()));
  await server.connect(new StdioServerTransport());
} catch (error) {
  // stdout carries the MCP protocol, so diagnostics go to stderr.
  console.error(`norish-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
