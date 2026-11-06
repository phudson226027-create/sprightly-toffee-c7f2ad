// Checks the edit password sent by the browser against the EDIT_PASSWORD setting.
export function passwordOk(req: Request) {
  const expected = Netlify.env.get("EDIT_PASSWORD");
  const given = req.headers.get("x-edit-password") || "";
  return Boolean(expected) && given === expected;
}
