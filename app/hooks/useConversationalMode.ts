"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseConversationalModeOptions {
  isSpeaking: boolean;
  isListening: boolean;
  isLoading: boolean;
  startListening: () => void;
  speak: (text: string) => void;
  onSpeechEnd?: () => void;
}

export interface UseConversationalModeReturn {
  isConversationalMode: boolean;
  toggleConversationalMode: () => void;
}

/**
 * Orchestrates a voice conversation loop:
 * listen → transcript → submit → response → TTS → listen → repeat
 *
 * Watches for TTS finishing (isSpeaking transitions true → false) to
 * restart listening automatically.
 */
export function useConversationalMode({
  isSpeaking,
  isListening,
  isLoading,
  startListening,
}: UseConversationalModeOptions): UseConversationalModeReturn {
  const [isConversationalMode, setIsConversationalMode] = useState(false);
  const wasSpeakingRef = useRef(false);

  const toggleConversationalMode = useCallback(() => {
    setIsConversationalMode((prev) => {
      const next = !prev;
      // When turning on, start listening immediately if not already
      if (next && !isListening && !isSpeaking && !isLoading) {
        startListening();
      }
      return next;
    });
  }, [isListening, isSpeaking, isLoading, startListening]);

  // Auto-relisten when TTS finishes (isSpeaking: true → false)
  useEffect(() => {
    if (isSpeaking) {
      wasSpeakingRef.current = true;
    } else if (wasSpeakingRef.current) {
      wasSpeakingRef.current = false;
      if (isConversationalMode && !isListening && !isLoading) {
        // Small delay to avoid overlap
        const timer = setTimeout(() => startListening(), 300);
        return () => clearTimeout(timer);
      }
    }
  }, [isSpeaking, isConversationalMode, isListening, isLoading, startListening]);

  return { isConversationalMode, toggleConversationalMode };
}
