import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Default to "Aria" — a natural, warm female voice. Users can change via env var.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "9BWtsMINqrJLrRacOk9x";

export async function POST(req: Request) {
  if (!ELEVENLABS_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ELEVENLABS_API_KEY is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = (await req.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return new Response(
      JSON.stringify({ error: "No text provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const client = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });

    const audioStream = await client.textToSpeech.convert(VOICE_ID, {
      text,
      modelId: "eleven_turbo_v2_5",
      outputFormat: "mp3_44100_128",
    });

    // The SDK returns a ReadableStream — pipe it as an audio response
    return new Response(audioStream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[tts]", err);
    return new Response(
      JSON.stringify({ error: "TTS generation failed" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
