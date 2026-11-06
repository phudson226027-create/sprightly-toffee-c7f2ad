import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { passwordOk } from "../lib/auth.js";

// Saves and loads the shop owner's edited version of the homepage.
// Anyone can read it; only someone with the edit password can change it.

const KEY = "homepage";


export default async (req: Request) => {
  const store = getStore({ name: "site-edits", consistency: "strong" });
  const url = new URL(req.url);

  if (url.pathname.endsWith("/unlock")) {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    return new Response(null, { status: passwordOk(req) ? 204 : 401 });
  }

  if (req.method === "GET") {
    const html = await store.get(KEY, { type: "text" });
    if (html === null) return new Response("Not found", { status: 404 });
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (req.method === "PUT") {
    if (!passwordOk(req)) return new Response("Wrong password", { status: 401 });
    const html = await req.text();
    if (!html.trim()) return new Response("Nothing to save", { status: 400 });
    await store.set(KEY, html);
    return new Response(null, { status: 204 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: ["/api/page", "/api/page/unlock"] };
