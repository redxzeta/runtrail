import { Hono } from "hono";
import type { HealthResponse } from "../shared/schemas.js";

export function createHealthRoute(): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const response: HealthResponse = {
      ok: true,
      service: "runtrail"
    };

    return c.json(response);
  });

  return route;
}
