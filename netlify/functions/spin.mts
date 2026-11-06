import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { requests } from "../../db/schema.js";
import { tooMany } from "../lib/limits.js";
import { sendText } from "../lib/text.js";

// "Feeling lucky?" spin: a 1 in 1,000 chance (0.1%) to win a free print, plus a
// "luck meter" that goes up by a random 0.1%–1% each day a visitor comes back.
// Win chance = 0.1% + luck. Luck resets to 0 after a win.
// The roll happens here on the server so nobody can fake a win in their browser.
// Winners get a code and are saved on the private /admin page as a "Free print" request.

// Chances are counted out of 100,000 (so 1 unit = 0.001%).
const SCALE = 100_000;
const BASE_CHANCE = 100; // 0.1% = 1 in 1,000
const DAILY_MIN = 100; // +0.1% luck per day...
const DAILY_MAX = 1_000; // ...up to +1%
const MAX_LUCK = SCALE - BASE_CHANCE; // win chance never goes above 100%
const SPINS_PER_DAY = 25; // per device
// Safety cap for one internet connection (e.g. a home Wi-Fi with several phones/computers),
// so someone can't get endless spins by making new device IDs.
const SPINS_PER_NETWORK = 250;
// "Close call" losses: on about 1 in 5 losing spins, the number shown lands just above
// 000.400 (000.400–000.999) to make it feel close. This only changes what is shown on a
// spin that already lost, so the real win chance stays 1 in 1,000 (plus luck).
const NEAR_MISS_ODDS = 5;
const NEAR_MISS_FLOOR = 400; // 0.400 — never shows below this
const NEAR_MISS_SPREAD = 600; // up to 0.999
const UNCLAIMED = "Unclaimed winner";

const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u0009\u000B-\u001F]/g, "").trim().slice(0, max);

function randomInt(max: number) {
  // Unbiased random number from 0 to max-1
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

function winCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "WIN-";
  for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)];
  return code;
}

const luckStore = () => getStore({ name: "spin-luck", consistency: "strong" });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

type Luck = { luck: number; day: string };

// Loads a visitor's luck and adds the daily boost the first time they show up each day.
async function getLuck(visitor: string): Promise<Luck> {
  const store = luckStore();
  const saved = ((await store.get(visitor, { type: "json" })) as Luck | null) ?? { luck: 0, day: "" };
  const day = today();
  if (saved.day === day) return saved;
  const boost = DAILY_MIN + randomInt(DAILY_MAX - DAILY_MIN + 1);
  const next = { luck: Math.min(MAX_LUCK, saved.luck + boost), day };
  await store.setJSON(visitor, next);
  return next;
}

const luckInfo = (l: Luck) => ({ luck: l.luck / 1000, chance: (BASE_CHANCE + l.luck) / 1000 });

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let data: Record<string, unknown>;
  try { data = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  if (data.action === "claim") {
    const code = clean(data.code, 20).toUpperCase();
    const name = clean(data.name, 80);
    const email = clean(data.email, 120);
    const phone = clean(data.phone, 30);
    if (!code || !name || !(email || phone)) {
      return Response.json({ error: "Please add your name and an email or phone number." }, { status: 400 });
    }
    if (await tooMany("claim", context.ip, 10, 10 * 60 * 1000)) {
      return Response.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
    }
    const updated = await db.update(requests)
      .set({ name, email: email || null, phone: phone || null, message: `Won a free print with code ${code}! Claimed by ${name}.` })
      .where(and(eq(requests.kind, "prize"), eq(requests.orderNumber, code), eq(requests.name, UNCLAIMED)))
      .returning({ id: requests.id });
    if (!updated.length) return Response.json({ error: "That prize code was not found or was already claimed." }, { status: 404 });
    await sendText(`Next Layer free print winner claimed their prize!\nCode: ${code}\nName: ${name}\nContact: ${[email, phone].filter(Boolean).join(" ")}`)
      .catch((e) => console.error("Text failed", e));
    return new Response(null, { status: 204 });
  }

  const visitor = clean(data.visitor, 40);
  if (!/^[a-zA-Z0-9-]{16,40}$/.test(visitor)) return Response.json({ error: "Please reload the page and try again." }, { status: 400 });

  // Just checking the luck meter (when the page loads)
  if (data.action === "luck") return Response.json(luckInfo(await getLuck(visitor)));

  // A normal spin. Each device gets its own 25 spins per day (rolling 24 hours),
  // so people on different devices (even on the same Wi-Fi) each get their own chances.
  const DAY = 24 * 60 * 60 * 1000;
  if (await tooMany("spin-device", visitor, SPINS_PER_DAY, DAY)) {
    return Response.json({ error: "You used all 25 spins for today. Come back tomorrow!" }, { status: 429 });
  }
  if (await tooMany("spin-network", context.ip, SPINS_PER_NETWORK, DAY)) {
    return Response.json({ error: "Too many spins from this network today. Come back tomorrow!" }, { status: 429 });
  }
  const luck = await getLuck(visitor);
  const chance = BASE_CHANCE + luck.luck;
  const roll = randomInt(SCALE); // 0 to 99,999; wins if it lands under the chance
  const shownRoll = roll / 1000; // as a percent, e.g. 73.124
  if (roll >= chance) {
    let shown = shownRoll;
    if (randomInt(NEAR_MISS_ODDS) === 0) {
      // Never show a number that would have been a win
      const floor = Math.max(NEAR_MISS_FLOOR, chance);
      shown = Math.min(SCALE - 1, floor + randomInt(NEAR_MISS_SPREAD)) / 1000;
    }
    return Response.json({ win: false, roll: shown, ...luckInfo(luck) });
  }

  const reset = { luck: 0, day: luck.day };
  await luckStore().setJSON(visitor, reset);

  const code = winCode();
  await db.insert(requests).values({
    kind: "prize",
    orderNumber: code,
    name: UNCLAIMED,
    message: `Someone won a free print with code ${code}! They have not added their contact info yet.`,
  });
  await sendText(`Someone just WON a free print on Next Layer! (their chance was ${(chance / 1000).toFixed(2)}%)\nCode: ${code}\nYou'll get another text when they add their contact info.`)
    .catch((e) => console.error("Text failed", e));
  return Response.json({ win: true, roll: shownRoll, code, ...luckInfo(reset) });
};

export const config: Config = { path: "/api/spin" };
