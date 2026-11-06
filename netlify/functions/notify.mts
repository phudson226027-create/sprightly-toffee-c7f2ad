import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { requests } from "../../db/schema.js";
import { tooMany } from "../lib/limits.js";
import { sendText } from "../lib/text.js";

// Saves new orders and contact messages (shown on the private /admin page),
// then texts the shop owner through Twilio when it's set up.
// Texting needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.

const MAX_PER_WINDOW = 5; // requests allowed per visitor...
const WINDOW_MS = 10 * 60 * 1000; // ...every 10 minutes

const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u0009\u000B-\u001F]/g, "").trim().slice(0, max);
const money = (n: number) => "$" + n.toFixed(2);

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  // Spam trap: real visitors never fill in this hidden field
  if (clean(data.website, 100)) return new Response(null, { status: 204 });

  let row: typeof requests.$inferInsert;
  let text: string;

  if (data.type === "order") {
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, 50).map((i: any) => ({
      name: clean(i?.name, 120),
      option: clean(i?.option, 400),
      quantity: Math.max(1, Math.min(999, Math.floor(Number(i?.quantity) || 1))),
      price: Math.max(0, Number(i?.price) || 0),
    })).filter((i) => i.name);
    const name = clean(data.name, 80);
    const meetupPlace = clean(data.meetupPlace, 200);
    const meetupTime = clean(data.meetupTime, 80);
    if (!items.length || !name) return Response.json({ error: "Missing order" }, { status: 400 });
    if (!meetupPlace || !meetupTime) return Response.json({ error: "Pick a meetup place and time." }, { status: 400 });
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    row = {
      kind: "order",
      orderNumber: clean(data.orderNumber, 20) || null,
      name,
      email: clean(data.email, 120) || null,
      phone: clean(data.phone, 30) || null,
      message: clean(data.notes, 800) || null,
      meetupPlace,
      meetupTime,
      items,
      total: total.toFixed(2),
    };
    text = `New Next Layer order ${row.orderNumber ?? ""}\n` +
      items.map((i) => `${i.name}${i.option ? ` (${i.option})` : ""} x ${i.quantity}`).join("\n") +
      `\nTotal: ${money(total)} (cash, paid first)\nMeet: ${meetupPlace} at ${meetupTime}\nFrom: ${name} ${row.email ?? ""} ${row.phone ?? ""}`;
  } else if (data.type === "message") {
    const name = clean(data.name, 80);
    const email = clean(data.email, 120);
    const phone = clean(data.phone, 30);
    const message = clean(data.message, 800);
    if (!name || !(email || phone) || !message) {
      return Response.json({ error: "Please fill in every field." }, { status: 400 });
    }
    row = { kind: "message", name, email: email || null, phone: phone || null, message };
    text = `New Next Layer message\nFrom: ${name} ${email} ${phone}\n${message}`;
  } else {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  if (await tooMany("notify", context.ip, MAX_PER_WINDOW, WINDOW_MS)) {
    return Response.json({ error: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }

  await db.insert(requests).values(row);
  await sendText(text).catch((e) => console.error("Text failed", e));
  return new Response(null, { status: 204 });
};

export const config: Config = { path: "/api/notify" };
