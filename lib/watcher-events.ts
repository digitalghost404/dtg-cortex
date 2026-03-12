export type WatcherEvent = {
  type: "add" | "change" | "unlink";
  name: string;      // note name without .md
  path: string;      // relative path
  timestamp: number;
};

type Listener = (event: WatcherEvent) => void;

class WatcherEventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: WatcherEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const watcherEvents = new WatcherEventBus();
