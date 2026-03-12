import { NextResponse } from "next/server";
import { getAllMemories, addMemory, deleteMemory } from "@/lib/memory";

export async function GET() {
  try {
    const memories = await getAllMemories();
    return NextResponse.json(memories);
  } catch (err) {
    console.error("[api/memory GET]", err);
    return NextResponse.json({ error: "Failed to load memories" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { content: string; type: string };
    const { content, type } = body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const validTypes = ["preference", "interest", "fact", "pattern"] as const;
    const memType = validTypes.includes(type as (typeof validTypes)[number])
      ? (type as (typeof validTypes)[number])
      : "fact";

    await addMemory({
      type: memType,
      content: content.trim(),
      source: "manual",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/memory POST]", err);
    return NextResponse.json({ error: "Failed to add memory" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as { id: string };
    const { id } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await deleteMemory(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/memory DELETE]", err);
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  }
}
