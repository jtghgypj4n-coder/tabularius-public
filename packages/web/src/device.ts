// The person's device, as FileMaker Go uses it: the camera for photos and bar codes, a signature pad, the
// microphone and photo library through the browser's file picker, and where the device is. Each sheet is opened
// by a tap (browsers only give the camera and file pickers to a person's own gesture) and resolves undefined when
// the person cancels.

/** Insert from Device's sources, as FileMaker names them. */
export type DeviceType = 'Camera' | 'Video Camera' | 'Microphone' | 'Photo Library' | 'Music Library' | 'Bar Code' | 'Signature';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

function button(label: string, run: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', ...attrs }, label);
  b.addEventListener('click', run);
  return b;
}

/** A modal sheet; `done` closes it with an answer, and closing it any other way (Escape, Cancel) answers undefined. */
function sheet<T>(title: string, build: (done: (v: T | undefined) => void, dialog: HTMLDialogElement) => (Node | string)[], cls = ''): Promise<T | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: `device-sheet ${cls}`.trim(), 'aria-label': title }) as HTMLDialogElement;
    let answer: T | undefined;
    const done = (v: T | undefined) => {
      answer = v;
      dialog.close();
    };
    dialog.append(h('h2', {}, title), ...build(done, dialog));
    dialog.addEventListener('close', () => {
      dialog.dispatchEvent(new Event('device-closed'));
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** A file picker, opened from a tap inside a sheet: a phone offers its camera or microphone when `capture` is set. */
function pickButton(label: string, accept: string, capture: string | undefined, done: (f: File | undefined) => void, attrs: Record<string, string> = {}): HTMLElement {
  const input = h('input', { type: 'file', accept, hidden: '', ...(capture ? { capture } : {}) }) as HTMLInputElement;
  input.addEventListener('change', () => {
    if (input.files?.[0]) done(input.files[0]);
  });
  return h('span', { class: 'pick' }, input, button(label, () => input.click(), attrs));
}

/** The camera's live picture, until the sheet closes; undefined when the browser can't or the person said no. */
async function camera(video: HTMLVideoElement, facing: 'back' | 'front', dialog: HTMLDialogElement): Promise<MediaStream | undefined> {
  if (!navigator.mediaDevices?.getUserMedia) return undefined;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing === 'front' ? 'user' : 'environment' }, audio: false });
    if (!dialog.open) {
      stream.getTracks().forEach((t) => t.stop());
      return undefined;
    }
    dialog.addEventListener('device-closed', () => stream.getTracks().forEach((t) => t.stop()), { once: true });
    video.srcObject = stream;
    await video.play().catch(() => {});
    return stream;
  } catch {
    return undefined;
  }
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/** Take Photo: the camera's picture in the sheet, with the device's own camera (or a file) as the other way. */
export function takePhoto(facing: 'back' | 'front' = 'back'): Promise<File | undefined> {
  return sheet<File>('Take Photo', (done, dialog) => {
    const video = h('video', { class: 'device-video', playsinline: '', muted: '', 'aria-label': 'Camera' }) as HTMLVideoElement;
    const note = h('p', { class: 'device-note' }, 'Starting the camera…');
    const shoot = button('Take Photo', () => {
      const canvas = h('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      canvas.toBlob((blob) => blob && done(new File([blob], `photo-${stamp()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.9);
    }, { class: 'primary', disabled: '' });
    void camera(video, facing, dialog).then((stream) => {
      if (stream) {
        note.remove();
        shoot.disabled = false;
      } else {
        video.remove();
        note.textContent = "This browser can't show the camera here. Use the device's camera instead, or choose a picture.";
      }
    });
    return [video, note, h('div', { class: 'actions' },
      button('Cancel', () => done(undefined)),
      h('span', { class: 'spacer' }),
      pickButton(matchMedia('(pointer: coarse)').matches ? 'Use Device Camera…' : 'Choose Picture…', 'image/*', facing === 'front' ? 'user' : 'environment', done),
      shoot)];
  });
}

/** A signature, drawn with a finger, pen or mouse, as a PNG. */
export function signature(title = 'Sign Here'): Promise<File | undefined> {
  return sheet<File>(title, (done) => {
    const canvas = h('canvas', { class: 'signature-pad', 'aria-label': 'Signature pad: draw your signature' }) as HTMLCanvasElement;
    const ratio = Math.max(1, devicePixelRatio || 1);
    let drawn = false;
    let last: { x: number; y: number } | undefined;
    const ctx = () => canvas.getContext('2d')!;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * ratio);
      canvas.height = Math.round(r.height * ratio);
      const c = ctx();
      c.scale(ratio, ratio);
      c.lineWidth = 2.4;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = '#111';
    };
    requestAnimationFrame(size);
    const at = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      last = at(e);
      const c = ctx();
      c.beginPath();
      c.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
      c.fillStyle = '#111';
      c.fill();
      drawn = true;
      ok.disabled = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = at(e);
      const c = ctx();
      c.beginPath();
      c.moveTo(last.x, last.y);
      c.lineTo(p.x, p.y);
      c.stroke();
      last = p;
    });
    const end = () => (last = undefined);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    const ok = button('Done', () => {
      if (!drawn) return;
      canvas.toBlob((blob) => blob && done(new File([blob], `signature-${stamp()}.png`, { type: 'image/png' })), 'image/png');
    }, { class: 'primary', disabled: '' });
    return [canvas, h('div', { class: 'actions' },
      button('Cancel', () => done(undefined)),
      button('Clear', () => {
        ctx().clearRect(0, 0, canvas.width, canvas.height);
        drawn = false;
        ok.disabled = true;
      }),
      h('span', { class: 'spacer' }), ok)];
  }, 'signature-sheet');
}

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare const BarcodeDetector: { new (): Detector } | undefined;

/**
 * Scan Bar Code: the camera reads QR codes and bar codes where the browser can (BarcodeDetector: Chrome and Edge on
 * Android, ChromeOS and macOS); typing the code works everywhere.
 */
export function scanBarcode(): Promise<string | undefined> {
  return sheet<string>('Scan Bar Code', (done, dialog) => {
    const video = h('video', { class: 'device-video', playsinline: '', muted: '', 'aria-label': 'Camera' }) as HTMLVideoElement;
    const note = h('p', { class: 'device-note' }, 'Starting the camera…');
    const typed = h('input', { type: 'text', class: 'barcode-typed', autocomplete: 'off', 'aria-label': 'Bar code', placeholder: 'Or type the code' }) as HTMLInputElement;
    const ok = button('Use Code', () => typed.value.trim() && done(typed.value.trim()), { class: 'primary' });
    typed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ok.click();
      }
    });
    const detector = typeof BarcodeDetector === 'function' ? (() => {
      try {
        return new BarcodeDetector!();
      } catch {
        return undefined;
      }
    })() : undefined;
    if (!detector) {
      note.textContent = "This browser can't read bar codes with the camera. Type the code, or scan it with the device's own scanner into this box.";
      queueMicrotask(() => typed.focus());
    } else {
      void camera(video, 'back', dialog).then((stream) => {
        if (!stream) {
          video.remove();
          note.textContent = "The camera isn't available here. Type the code instead.";
          typed.focus();
          return;
        }
        note.textContent = 'Point the camera at a bar code or QR code.';
        const look = async () => {
          if (!dialog.open) return;
          try {
            const found = video.readyState >= 2 ? await detector.detect(video) : [];
            if (found[0]?.rawValue) {
              done(found[0].rawValue);
              return;
            }
          } catch {
            // a frame that couldn't be read: try the next
          }
          setTimeout(() => void look(), 150);
        };
        void look();
      });
    }
    return [...(detector ? [video] : []), note, typed, h('div', { class: 'actions' }, button('Cancel', () => done(undefined)), h('span', { class: 'spacer' }), ok)];
  });
}

/** A recording or a file from the device's library, through the browser's picker (the camera or microphone on a phone). */
export function pickMedia(type: DeviceType): Promise<File | undefined> {
  const kinds: Record<string, [string, string, string | undefined]> = {
    'Video Camera': ['Record Video', 'video/*', 'environment'],
    Microphone: ['Record Sound', 'audio/*', 'user'],
    'Photo Library': ['Choose Photo', 'image/*,video/*', undefined],
    'Music Library': ['Choose Sound', 'audio/*', undefined],
  };
  const [title, accept, capture] = kinds[type] ?? ['Choose File', '*/*', undefined];
  return sheet<File>(title, (done) => [
    h('p', { class: 'device-note' }, capture ? 'Your device records it and puts it in the field.' : 'Choose it from your device.'),
    h('div', { class: 'actions' }, button('Cancel', () => done(undefined)), h('span', { class: 'spacer' }), pickButton(`${title}…`, accept, capture, done, { class: 'primary' })),
  ]);
}

/** What Insert from Device asks for: a file for media and signatures, text for a bar code. */
export async function fromDevice(type: DeviceType, camera?: 'back' | 'front'): Promise<File | string | undefined> {
  if (type === 'Bar Code') return scanBarcode();
  if (type === 'Signature') return signature();
  if (type === 'Camera') return takePhoto(camera);
  return pickMedia(type);
}

export interface Located { latitude: number; longitude: number; accuracy: number; altitude?: number; altitudeAccuracy?: number; at: number }

/** Where the device is: the browser asks the person the first time. Undefined when they refuse or it can't tell. */
export function locate(timeoutMs = 15_000): Promise<Located | undefined> {
  if (!navigator.geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((p) => resolve({
      latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy,
      ...(p.coords.altitude !== null ? { altitude: p.coords.altitude } : {}),
      ...(p.coords.altitudeAccuracy !== null ? { altitudeAccuracy: p.coords.altitudeAccuracy } : {}),
      at: p.timestamp,
    }), () => resolve(undefined), { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 });
  });
}
