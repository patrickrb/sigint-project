/** Simple client-side event bus for triggering cross-component refreshes */
const EVENT_NAME = "rf-data-changed";

export function emitDataChanged() {
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function onDataChanged(callback: () => void): () => void {
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}
