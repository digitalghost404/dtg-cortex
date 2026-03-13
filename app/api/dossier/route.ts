import { NextRequest, NextResponse } from "next/server";
import { getDossier, listDossierIds, deleteDossier, markSavedToVault } from "@/lib/dossier";
import { generateDossier } from "@/lib/dossier-generator";
import { mget } from "@/lib/kv";
import type { Dossier } from "@/lib/dossier";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  try {
    if (id) {
      const dossier = await getDossier(id);
      if (!dossier) {
        return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
      }
      return NextResponse.json(dossier);
    }

    // List all dossiers
    const ids = await listDossierIds();
    const keys = ids.map((id) => `dossier:${id}`);
    const dossiers = keys.length > 0 ? await mget<Dossier>(...keys) : [];

    const list = dossiers
      .filter((d): d is Dossier => d !== null)
      .map((d) => ({
        id: d.id,
        topic: d.topic,
        createdAt: d.createdAt,
        savedToVault: d.savedToVault,
        vaultFindingCount: d.vaultFindings.length,
        webFindingCount: d.webFindings.length,
      }));

    return NextResponse.json({ dossiers: list });
  } catch (err) {
    console.error("[dossier GET]", err);
    return NextResponse.json({ error: "Failed to fetch dossiers" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Handle "save to vault" action
    if (body.action === "saveToVault" && body.id) {
      await markSavedToVault(body.id);
      return NextResponse.json({ ok: true });
    }

    const topic = body.topic;
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    const dossier = await generateDossier(topic.trim());
    return NextResponse.json(dossier, { status: 201 });
  } catch (err) {
    console.error("[dossier POST]", err);
    return NextResponse.json({ error: "Failed to generate dossier" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await deleteDossier(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[dossier DELETE]", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
