import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import type { RuntrailConfig } from "../config.js";
import { createHttpClient, createRuntrailMcpServer } from "../mcp/index.js";

type McpRouteOptions = {
  config: RuntrailConfig;
};

export function createMcpRoute(options: McpRouteOptions): Hono {
  const route = new Hono();

  route.use("*", async (c, next) => {
    if (!options.config.security.authRequired) {
      await next();
      return;
    }

    const expectedToken = options.config.security.token;
    const authorization = c.req.header("authorization");

    if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  });

  route.all("/", async (c) => {
    const server = createRuntrailMcpServer(createHttpClient(options.config));
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  return route;
}
