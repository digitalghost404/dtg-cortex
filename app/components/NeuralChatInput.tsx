"use client";

import { useRef, useEffect } from "react";

interface NeuralChatInputProps {
  input: string;
  setInput: (val: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  isLoading: boolean;
  streamingText: string;
  lastResponse: string;
}

export default function NeuralChatInput({
  input,
  setInput,
  onSubmit,
  isLoading,
  streamingText,
  lastResponse,
}: NeuralChatInputProps) {
  const responseRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll response area
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [streamingText, lastResponse]);

  const displayText = isLoading ? streamingText : lastResponse;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        padding: "0 1rem 0.5rem",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          pointerEvents: "auto",
        }}
      >
        {/* Response area */}
        {displayText && (
          <div
            ref={responseRef}
            style={{
              maxHeight: 120,
              overflowY: "auto",
              marginBottom: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "rgba(2,4,8,0.85)",
              border: "1px solid var(--border-dim)",
              borderRadius: "4px",
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              lineHeight: "1.5",
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
              backdropFilter: "blur(8px)",
            }}
          >
            {displayText}
            {isLoading && (
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 12,
                  background: "var(--cyan-bright)",
                  marginLeft: 2,
                  animation: "blink 0.8s infinite",
                }}
              />
            )}
          </div>
        )}

        {/* Input bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(e);
          }}
          style={{
            display: "flex",
            gap: "0.5rem",
            background: "rgba(2,4,8,0.9)",
            border: "1px solid var(--border-dim)",
            borderRadius: "4px",
            padding: "0.35rem 0.5rem",
            backdropFilter: "blur(8px)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ASK YOUR VAULT..."
            disabled={isLoading}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              color: "var(--text-primary)",
              padding: "0.25rem 0",
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="btn-secondary"
            style={{
              fontSize: "0.55rem",
              letterSpacing: "0.12em",
              padding: "3px 10px",
              borderRadius: "2px",
              opacity: isLoading || !input.trim() ? 0.4 : 1,
              cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "..." : "PULSE"}
          </button>
        </form>
      </div>
    </div>
  );
}
