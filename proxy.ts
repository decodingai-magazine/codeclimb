// HTTP Basic Auth in front of the whole app: one user, credentials from
// CODECLIMB_USER / CODECLIMB_PASSWORD. Fails closed when either is unset.
// /api/inngest stays open: Inngest signs its requests with the signing key.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Hashing first gives equal-length buffers, so the comparison leaks neither content nor length.
const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function authorized(header: string | null): boolean {
  const user = process.env.CODECLIMB_USER;
  const password = process.env.CODECLIMB_PASSWORD;
  if (!user || !password || !header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  // Both checks always run, so timing doesn't tell which one failed.
  const userOk = same(decoded.slice(0, colon), user);
  const passwordOk = same(decoded.slice(colon + 1), password);
  return userOk && passwordOk;
}

export function proxy(request: NextRequest) {
  if (authorized(request.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="codeclimb", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!api/inngest|_next/static|_next/image|favicon.ico).*)"],
};
