"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Browser type augmentation — SpeechRecognition is not in lib.dom.d.ts by
// default for all TS targets, so we declare just enough to keep the compiler
// happy without pulling in an extra @types package.
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

// Resolve the constructor from either the standard or webkit-prefixed global.
function getSpeechRecognitionConstructor():
  | (new () => SpeechRecognitionInstance)
  | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseVoiceInputOptions {
  lang?: string;
}

export interface UseVoiceInputReturn {
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

/**
 * useVoiceInput
 *
 * Wraps the Web Speech API's SpeechRecognition interface.
 * Fires `onTranscript(text, isFinal)` as speech is recognised.
 *
 * @param onTranscript  Called with the transcribed text and whether it is a
 *                      final (committed) result or an interim (in-progress) one.
 * @param options       Optional `lang` override (defaults to the browser locale).
 */
export function useVoiceInput(
  onTranscript: (text: string, isFinal: boolean) => void,
  options: UseVoiceInputOptions = {}
): UseVoiceInputReturn {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  const isSupported = SpeechRecognition !== null;

  const [isListening, setIsListening] = useState(false);

  // Keep a stable ref to the current recognition instance so we can stop it
  // without needing it in dependency arrays.
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Keep a stable ref to the callback so the recognition event handler always
  // calls the latest version without recreating the recognition instance.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) return;

    // Abort any in-flight session before starting a new one.
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = options.lang ?? "";

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;
        onTranscriptRef.current(transcript, isFinal);
      }
    };

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      // "aborted" fires when we call .abort() ourselves — not a real error.
      if (e.error !== "aborted") {
        console.warn("[useVoiceInput] SpeechRecognition error:", e.error);
      }
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognition.onend = () => {
      // Only clear state if this recognition instance is still current —
      // a new session may have already replaced it.
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [SpeechRecognition, options.lang]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return { isListening, isSupported, startListening, stopListening };
}
