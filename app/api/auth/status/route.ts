import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJWT, isSetupComplete, COOKIE_NAME } from "@/lib/auth";

export async function GET() {
  const setupComplete = await isSetupComplete();

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false, setupComplete });
  }

  const payload = await verifyJWT(token);
  if (!payload) {
    return NextResponse.json({ authenticated: false, setupComplete });
  }

  return NextResponse.json({ authenticated: true, setupComplete });
}
