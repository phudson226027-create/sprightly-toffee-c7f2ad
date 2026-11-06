// Texts the shop owner through Twilio when it is set up.
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.

const OWNER_PHONE = "+18057504712";

export async function sendText(text: string) {
  const sid = Netlify.env.get("TWILIO_ACCOUNT_SID");
  const token = Netlify.env.get("TWILIO_AUTH_TOKEN");
  const from = Netlify.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) {
    // MOCK MODE: Twilio isn't set up, so the text is only written to the function logs.
    console.log(`[MOCK TEXT - Twilio not set up] To ${OWNER_PHONE}:\n${text}`);
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${sid}:${token}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: OWNER_PHONE, From: from, Body: text.slice(0, 1500) }),
  });
  if (!res.ok) console.error("Twilio error", res.status, await res.text());
}
