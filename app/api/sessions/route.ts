import { NextResponse } from "next/server";
import { getSessions, createSession } from "@/lib/sessions";

export async function GET() {
  try {
    const sessions = getSessions();
    return NextResponse.json(sessions);
  } catch (err) {
    console.error("[sessions GET]", err);
    return NextResponse.json({ error: "Failed to read sessions" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = createSession();
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    console.error("[sessions POST]", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
