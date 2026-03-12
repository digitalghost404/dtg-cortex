import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeToken, COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  // H-5: Server-side token revocation — invalidate the JWT before clearing cookie
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await revokeToken(token);
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
