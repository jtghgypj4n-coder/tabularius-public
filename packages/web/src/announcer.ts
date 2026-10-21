/** A single, polite channel for concise client state changes. */
export interface AnnouncementSink {
  (message: string): void;
}

/** Collapses a burst into its latest message, so one rapid interaction speaks once. */
export function createAnnouncer(sink: AnnouncementSink, delay = 180): (message: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = '';
  return (message) => {
    pending = message;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      sink(pending);
    }, delay);
  };
}

let region: HTMLElement | undefined;
function liveRegion(): HTMLElement {
  if (!region?.isConnected) {
    region = document.createElement('div');
    region.className = 'sr-only tabularius-announcer';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
  }
  return region;
}

const delayed = createAnnouncer((message) => {
  const node = liveRegion();
  // Clearing first also makes a repeated announcement observable to accessibility APIs.
  node.textContent = '';
  requestAnimationFrame(() => { if (node.isConnected) node.textContent = message; });
});

/** Announce only generic, non-sensitive state. Callers must never pass field values. */
export function announce(message: string): void {
  delayed(message);
}
