// Lightweight credential check for the Writers Studio's login gate.
//   POST /api/writer  (x-writer-password header)  -> {ok:true} | 401
// Same shape as artist.js: the studio UI gate is UX only (content is public
// via GET /api/content); the real boundary is the story-scoped publish in
// content.js (_writerscope.js).
import { checkWriterPassword, json } from "./content.js";

export async function onRequestPost({ request, env }) {
  const denied = checkWriterPassword(request, env);
  if (denied) return denied;
  return json({ ok: true });
}
