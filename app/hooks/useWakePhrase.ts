"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Browser type augmentation (same as useVoiceInput.ts)
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

export interface UseWakePhraseReturn {
  isWakeActive: boolean;
  startWakeDetection: () => void;
  stopWakeDetection: () => void;
}

const WAKE_PATTERN = /hey\s+cortex/i;

/**
 * Background listener for "Hey Cortex" wake phrase.
 *
 * Uses continuous SpeechRecognition to listen for the wake phrase in interim
 * results. On detection, fires `onWake()` callback and stops the wake listener.
 * The parent component should restart wake detection after the voice interaction
 * completes.
 *
 * Works in Chrome/Edge (continuous recognition support). Degrades gracefully
 * in other browsers.
 */
export function useWakePhrase(
  onWake: () => void
): UseWakePhraseReturn {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  const [isWakeActive, setIsWakeActive] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onWakeRef = useRef(onWake);

  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  const stopWakeDetection = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsWakeActive(false);
  }, []);

  const startWakeDetection = useCallback(() => {
    if (!SpeechRecognition) return;

    // Abort any existing session
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (WAKE_PATTERN.test(transcript)) {
          // Wake phrase detected — stop listening and fire callback
          recognition.abort();
          recognitionRef.current = null;
          setIsWakeActive(false);
          onWakeRef.current();
          return;
        }
      }
    };

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "aborted") return;
      // "no-speech" is common — just restart
      if (e.error === "no-speech") {
        // Restart after a brief pause
        setTimeout(() => {
          if (recognitionRef.current === recognition) {
            try {
              recognition.start();
            } catch {
              // Already started or disposed
            }
          }
        }, 100);
        return;
      }
      console.warn("[useWakePhrase] SpeechRecognition error:", e.error);
      recognitionRef.current = null;
      setIsWakeActive(false);
    };

    recognition.onend = () => {
      // Auto-restart if still active (continuous mode can end unexpectedly)
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          recognitionRef.current = null;
          setIsWakeActive(false);
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsWakeActive(true);
    } catch {
      recognitionRef.current = null;
      setIsWakeActive(false);
    }
  }, [SpeechRecognition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return { isWakeActive, startWakeDetection, stopWakeDetection };
}
