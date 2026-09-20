interface ReconnectableControls {
  connect(element: HTMLElement): void;
  disconnect(): void;
}

export function reconnectControls(controls: ReconnectableControls, element: HTMLElement): () => void {
  controls.disconnect();
  controls.connect(element);
  return () => controls.disconnect();
}
