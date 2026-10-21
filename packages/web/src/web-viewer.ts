// A viewer's script address and history belong to record identities, never list or portal positions.
export type ViewerAction = 'Reset' | 'Reload' | 'Go Back' | 'Go Forward' | 'Go to URL';

/** The sandboxed frame reports navigation and calls page functions through its parent. */
export function webViewerBridge(origin: string, documentId: string): string {
  const literal = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<script>
var parentOrigin=${literal(origin)},documentId=${literal(documentId)},restoring,previous,currentHash=location.hash,position={x:scrollX,y:scrollY};
// srcdoc inherits the app's base URL: activate fragment links against this document instead.
addEventListener('click',function(e){
  var a=e.target.closest&&e.target.closest('a[href]');
  var hash=a&&a.getAttribute('href');
  if(e.defaultPrevented||e.button!==0||typeof hash!=='string'||!/^#[^\\x00-\\x1f]*$/.test(hash))return;
  e.preventDefault();
  previous={x:scrollX,y:scrollY};
  location.hash=hash;
});
addEventListener('scroll',function(){
  if(restoring||currentHash!==location.hash)return;
  position={x:scrollX,y:scrollY};
  parent.postMessage({tabularius:'scroll',documentId:documentId,x:scrollX,y:scrollY},parentOrigin);
});
addEventListener('hashchange',function(){
  if(restoring&&location.hash===restoring.hash){scrollTo(restoring.x,restoring.y);currentHash=location.hash;position={x:restoring.x,y:restoring.y};restoring=undefined;previous=undefined;return}
  parent.postMessage({tabularius:'navigation',documentId:documentId,hash:location.hash,x:scrollX,y:scrollY,previous:previous||position},parentOrigin);
  currentHash=location.hash;position={x:scrollX,y:scrollY};previous=undefined;
});
addEventListener('message',function(e){
  var d=e.data;
  if(e.source!==parent||e.origin!==parentOrigin||!d||d.documentId!==documentId)return;
  if(d.tabularius==='hash'&&typeof d.hash==='string'&&/^(?:#[^\\x00-\\x1f]*)?$/.test(d.hash)){
    var x=Number.isFinite(d.x)?d.x:0,y=Number.isFinite(d.y)?d.y:0;
    if(location.hash===d.hash){scrollTo(x,y);position={x:x,y:y};return}
    restoring={hash:d.hash,x:x,y:y};location.hash=d.hash;return;
  }
  if(d.tabularius!=='call'||typeof d.fn!=='string'||typeof d.id!=='string'||!Array.isArray(d.args)||d.args.some(function(x){return typeof x!=='string'}))return;
  // The script waits for the call itself, not for what the function awaits: it may ask the window to run a script, which waits for this one.
  try{var f=window[d.fn];if(typeof f==='function'){var out=f.apply(window,d.args);if(out&&typeof out.then==='function')out.then(null,function(x){console.error(x)})}else console.error('Perform JavaScript in Web Viewer: no function '+d.fn)}
  catch(x){console.error(x)}
  finally{parent.postMessage({tabularius:'called',documentId:documentId,id:d.id},parentOrigin)}
});
</script>`;
}

/** allow-scripts srcdoc has an opaque origin; require the expected source and document as well. */
export function viewerMessage(event: Pick<MessageEvent, 'source' | 'origin' | 'data'>, frame: Pick<HTMLIFrameElement, 'contentWindow' | 'dataset'>): boolean {
  return event.origin === 'null' && event.source !== null && event.source === frame.contentWindow
    && typeof frame.dataset.viewerDocument === 'string' && event.data?.documentId === frame.dataset.viewerDocument;
}

export function restoreViewer(frame: HTMLIFrameElement, state: ViewerState): void {
  // Another site's page is told nothing: not the document id that vouches for our own frames, nor where the person was.
  if (frame.dataset.external === '1') return;
  frame.contentWindow?.postMessage({ tabularius: 'hash', documentId: frame.dataset.viewerDocument, hash: state.hash ?? '', ...state.scroll }, '*');
}

export function viewerKey(window: string, layout: number, record: string, object: number, child = ''): string {
  return JSON.stringify([window, layout, record, object, child]);
}

export class ViewerState {
  layoutUrl?: string;
  private history: { url?: string; hash?: string; x?: number; y?: number; document: number }[];
  private document = 0;
  private index = 0;
  generation = 0;
  private selected = false;

  constructor(url?: string) {
    this.layoutUrl = url;
    this.history = [{ url, document: ++this.document }];
  }

  get url(): string | undefined { return this.history[this.index].url; }
  get hash(): string | undefined { return this.history[this.index].hash; }
  get scroll(): { x: number; y: number } { return { x: this.history[this.index].x ?? 0, y: this.history[this.index].y ?? 0 }; }

  /** Ordinary formula evaluation updates the setup address, without undoing a script's navigation. */
  address(url?: string): void {
    this.layoutUrl = url;
    if (!this.selected && this.url !== url) {
      this.history = [{ url, document: ++this.document }];
      this.index = 0;
      this.generation++;
    }
  }

  apply(action: ViewerAction, url?: string): boolean {
    if (action === 'Go Back' || action === 'Go Forward') {
      const next = this.index + (action === 'Go Back' ? -1 : 1);
      if (next < 0 || next >= this.history.length) return false;
      const sameDocument = this.history[this.index].document === this.history[next].document;
      this.index = next;
      this.selected = true;
      if (sameDocument) return true;
    } else if (action === 'Reset') {
      this.history = [{ url: this.layoutUrl, document: ++this.document }];
      this.index = 0;
      this.selected = false;
    } else if (action === 'Go to URL') {
      this.history.splice(this.index + 1);
      this.history.push({ url, document: ++this.document });
      this.index++;
    } else if (action !== 'Reload') return false;
    if (action !== 'Reset') this.selected = true;
    this.generation++;
    return true;
  }

  scrolled(x: number, y: number): void {
    if (Number.isFinite(x) && Number.isFinite(y)) Object.assign(this.history[this.index], { x, y });
  }

  /** The validated frame bridge reports hash navigation; external/in-document document loads stay blocked. */
  navigate(hash: string, scroll = { x: 0, y: 0 }, previous?: { x: number; y: number }): void {
    if (!/^(?:#[^\u0000-\u001f]*)?$/.test(hash) || !this.url?.startsWith('data:text/html')) return;
    if (hash === (this.hash ?? '')) return;
    if (previous && Number.isFinite(previous.x) && Number.isFinite(previous.y)) Object.assign(this.history[this.index], previous);
    this.history.splice(this.index + 1);
    this.history.push({ url: this.url, document: this.history[this.index].document, hash, x: Number.isFinite(scroll.x) ? scroll.x : 0, y: Number.isFinite(scroll.y) ? scroll.y : 0 });
    this.index++;
    this.selected = true;
  }
}
