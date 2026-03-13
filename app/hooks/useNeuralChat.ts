import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SourceUrlUIPart } from "ai";

// ---------------------------------------------------------------------------
// Hook — wraps useChat and maps source-url parts to neuron activations
// ---------------------------------------------------------------------------

export function useNeuralChat(
  neuronsByPath: Map<string, number>,
  activateNeuron: (neuronIdx: number, score: number, sequenceIndex: number) => void
) {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const [input, setInput] = useState("");
  const isLoading = status === "streaming" || status === "submitted";

  // Track which sources we've already fired activations for
  const firedSourcesRef = useRef(new Set<string>());
  const sequenceRef = useRef(0);

  // Watch streaming message for new source-url parts
  useEffect(() => {
    if (!isLoading) {
      // Reset tracking when not loading
      firedSourcesRef.current.clear();
      sequenceRef.current = 0;
      return;
    }

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const sources = lastMsg.parts.filter(
      (p): p is SourceUrlUIPart => p.type === "source-url"
    );

    for (const src of sources) {
      const key = `${src.url}|${src.sourceId}`;
      if (firedSourcesRef.current.has(key)) continue;
      firedSourcesRef.current.add(key);

      const neuronIdx = neuronsByPath.get(src.url);
      if (neuronIdx === undefined) continue;

      const score = parseFloat(src.sourceId?.split("|")[1] ?? "0.5");
      activateNeuron(neuronIdx, Math.max(0.3, score), sequenceRef.current);
      sequenceRef.current++;
    }
  }, [messages, isLoading, neuronsByPath, activateNeuron]);

  // Extract streaming response text
  const streamingText = (() => {
    if (!isLoading) return "";
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return "";
    return lastMsg.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  })();

  // Last completed assistant message
  const lastResponse = (() => {
    if (isLoading) return "";
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
      }
    }
    return "";
  })();

  const submit = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const text = input.trim();
      if (!text) return;
      sendMessage({ parts: [{ type: "text", text }] });
      setInput("");
    },
    [input, sendMessage]
  );

  return {
    input,
    setInput,
    submit,
    isLoading,
    streamingText,
    lastResponse,
    activeSourceCount: sequenceRef.current,
  };
}
