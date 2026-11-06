import type { Config } from "@netlify/functions";
import { count, desc, eq, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { requests } from "../../db/schema.js";
import { passwordOk } from "../lib/auth.js";

// Private list of orders and messages for the /admin page. Needs the edit password.
export default async (req: Request) => {
  if (!passwordOk(req)) return Response.json({ error: "Wrong password" }, { status: 401 });

  if (req.method === "GET" && new URL(req.url).searchParams.has("count")) {
    const [{ value }] = await db.select({ value: count() }).from(requests).where(ne(requests.status, "done"));
    return Response.json({ new: Number(value) }, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "GET") {
    const rows = await db.select().from(requests).orderBy(desc(requests.createdAt)).limit(500);
    return Response.json(rows, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "PATCH" || req.method === "DELETE") {
    let body: { id?: unknown; status?: unknown };
    try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Bad id" }, { status: 400 });
    if (req.method === "DELETE") {
      await db.delete(requests).where(eq(requests.id, id));
    } else {
      const status = body.status === "done" ? "done" : "new";
      await db.update(requests).set({ status }).where(eq(requests.id, id));
    }
    return new Response(null, { status: 204 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/requests" };
