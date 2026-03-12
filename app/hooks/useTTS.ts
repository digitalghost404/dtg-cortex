"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseTTSReturn {
  isSpeaking: boolean;
  isSupported: boolean; // always true — we use server-side ElevenLabs
  speak: (text: string) => void;
  stop: () => void;
}

/**
 * Strip markdown formatting and symbols so TTS reads natural prose.
 */
function cleanForSpeech(raw: string): string {
  let t = raw;

  // Remove code blocks (``` ... ```)
  t = t.replace(/```[\s\S]*?```/g, " code block omitted ");
  // Remove inline code (`...`)
  t = t.replace(/`([^`]*)`/g, "$1");
  // Remove markdown headings (## ...)
  t = t.replace(/^#{1,6}\s+/gm, "");
  // Remove bold/italic markers
  t = t.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  t = t.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  // Remove strikethrough
  t = t.replace(/~~([^~]+)~~/g, "$1");
  // Remove markdown links [text](url) → text
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Remove bare URLs
  t = t.replace(/https?:\/\/\S+/g, "");
  // Remove wikilinks [[Note Name]] → Note Name
  t = t.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1");
  // Remove horizontal rules (---, ***, ___)
  t = t.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, "");
  // Remove bullet/list markers
  t = t.replace(/^[\s]*[-*+]\s+/gm, "");
  t = t.replace(/^[\s]*\d+[.)]\s+/gm, "");
  // Remove blockquote markers
  t = t.replace(/^>\s+/gm, "");
  // Remove HTML tags
  t = t.replace(/<[^>]+>/g, "");
  // Collapse multiple newlines/spaces into a single pause
  t = t.replace(/\n{2,}/g, ". ");
  t = t.replace(/\n/g, " ");
  t = t.replace(/\s{2,}/g, " ");
  // Remove emojis and other unicode symbols
  t = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]/gu, "");
  // Remove leftover symbols that sound bad spoken
  t = t.replace(/[|•·—–]/g, " ");
  t = t.replace(/\s{2,}/g, " ");

  return t.trim();
}

export function useTTS(): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    // Abort in-flight fetch
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    // Stop browser speech synthesis fallback
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined") return;

      const cleaned = cleanForSpeech(text);
      if (!cleaned) return;

      // Stop any current playback first
      if (abortRef.current) abortRef.current.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsSpeaking(true);

      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleaned }),
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`TTS API error: ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          if (controller.signal.aborted) return;

          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(url);
            if (audioRef.current === audio) {
              audioRef.current = null;
              setIsSpeaking(false);
            }
          };

          audio.onerror = () => {
            URL.revokeObjectURL(url);
            if (audioRef.current === audio) {
              audioRef.current = null;
              setIsSpeaking(false);
            }
          };

          audio.play().catch(() => {
            URL.revokeObjectURL(url);
            audioRef.current = null;
            setIsSpeaking(false);
          });
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.warn("[useTTS] ElevenLabs error, falling back to browser TTS:", err);
          // Fallback to browser speech synthesis
          fallbackBrowserSpeak(cleaned);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Fallback to browser speech synthesis if ElevenLabs fails
  function fallbackBrowserSpeak(text: string) {
    if (!("speechSynthesis" in window)) {
      setIsSpeaking(false);
      return;
    }
    // Cancel any prior utterances to prevent queue buildup / looping
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.name === "Google US English") ??
      voices.find((v) => v.lang === "en-US") ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null;
    if (preferred) utterance.voice = preferred;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = (ev) => {
      // "interrupted" fires when we call cancel() — not a real error
      if (ev.error !== "interrupted") setIsSpeaking(false);
    };
    window.speechSynthesis.speak(utterance);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { isSpeaking, isSupported: true, speak, stop };
}
