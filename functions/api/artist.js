// Lightweight credential check for the Art Studio's login gate.
//   POST /api/artist  (x-artist-password header)  -> {ok:true} | 401
// The studio UI is gated client-side for UX only (content itself is public
// via GET /api/content); the real security boundary is the art-scoped
// publish in content.js. This endpoint just lets the studio verify the
// password up front so the artist isn't surprised at publish time.
import { checkArtistPassword, json } from "./content.js";

export async function onRequestPost({ request, env }) {
  const denied = checkArtistPassword(request, env);
  if (denied) return denied;
  return json({ ok: true });
}
