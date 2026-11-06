import { getStore } from "@netlify/blobs";

// Returns true when a visitor has made more than `max` requests in the last `windowMs`.
export async function tooMany(bucket: string, ip: string, max: number, windowMs: number) {
  const store = getStore({ name: "text-limits", consistency: "strong" });
  const now = Date.now();
  const key = `${bucket}-` + (ip.replace(/[^a-zA-Z0-9.:-]/g, "_") || "unknown");
  const seen = ((await store.get(key, { type: "json" })) as number[] | null) ?? [];
  const recent = seen.filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  await store.setJSON(key, recent);
  return false;
}
