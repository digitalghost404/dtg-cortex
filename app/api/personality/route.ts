import { NextResponse } from "next/server";
import { loadPersonality, savePersonality, PersonalitySettings } from "@/lib/personality";

export async function GET() {
  const settings = loadPersonality();
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const keys: (keyof PersonalitySettings)[] = ["formality", "length", "challenge", "creativity"];

  for (const key of keys) {
    const val = b[key];
    if (typeof val !== "number" || val < 0 || val > 100) {
      return NextResponse.json(
        { error: `Field "${key}" must be a number between 0 and 100` },
        { status: 400 },
      );
    }
  }

  const settings: PersonalitySettings = {
    formality: b.formality as number,
    length: b.length as number,
    challenge: b.challenge as number,
    creativity: b.creativity as number,
  };

  savePersonality(settings);
  return NextResponse.json(settings);
}
