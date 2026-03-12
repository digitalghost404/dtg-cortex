import { NextResponse } from "next/server";
import { getSession, saveSession, deleteSession } from "@/lib/sessions";
import type { Message } from "@/lib/sessions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (err) {
    console.error("[session GET]", err);
    return NextResponse.json({ error: "Failed to read session" }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = (await req.json()) as { messages?: Message[] };
    if (body.messages !== undefined) {
      session.messages = body.messages;

      // Update title from the first user message if still default
      if (session.title === "New Session") {
        const firstUserMsg = body.messages.find((m) => m.role === "user");
        if (firstUserMsg) {
          const text = firstUserMsg.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join(" ")
            .trim();
          if (text.length > 0) {
            session.title = text.slice(0, 40) + (text.length > 40 ? "..." : "");
          }
        }
      }
    }

    session.updatedAt = new Date().toISOString();
    await saveSession(session);
    return NextResponse.json(session);
  } catch (err) {
    console.error("[session PUT]", err);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    await deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[session DELETE]", err);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
