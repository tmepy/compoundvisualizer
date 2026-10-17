import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Maximize2, RotateCcw } from 'lucide-react';

export const ELEMENT_COLORS: Record<string, string> = { H: '#ffffff', C: '#909090', N: '#3050f8', O: '#ff0d0d', F: '#90e050', Cl: '#1ff01f', Br: '#a62929', I: '#940094', He: '#d9ffff', P: '#ff8000', S: '#ffff30', Na: '#ab5cf2', K: '#8f40d4', Ca: '#3dff00', Fe: '#e06633', Mg: '#8aff00', Zn: '#7d80b0', Si: '#f0c8a0', B: '#ffb5b5', Cu: '#c88033' };
type Atom = { index: number; elem: string; serial?: number };
type GLViewer = {
  addModel: (data: string, format: string) => void;
  setStyle: (selection: object, style: object) => void;
  addStyle: (selection: object, style: object) => void;
  setBackgroundColor: (color: string) => void;
  zoomTo: () => void; render: () => void; resize: () => void;
  addPropertyLabels: (property: string, selection: object, style: object) => void;
  removeAllLabels: () => void;
  setClickable: (selection: object, enabled: boolean, callback: (atom: Atom) => void) => void;
  clear: () => void;
};

export default function Viewer({ sdf, dark, hydrogens, labels, highlight }: { sdf: string; dark: boolean; hydrogens: boolean; labels: boolean; highlight: number[] }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<GLViewer | null>(null);
  const [error, setError] = useState('');
  const [atom, setAtom] = useState<Atom | null>(null);
  const [controlError, setControlError] = useState('');
  const settings = useRef({ dark, hydrogens, labels, highlight });
  settings.current = { dark, hydrogens, labels, highlight };
  function applySettings(v: GLViewer) {
    const current = settings.current;
    v.setBackgroundColor(current.dark ? '#162323' : '#f6f8f5');
    v.setStyle({}, { stick: { radius: .12, colorscheme: 'Jmol' }, sphere: { scale: .28, colorscheme: 'Jmol' } });
    if (!current.hydrogens) v.setStyle({ elem: 'H' }, {});
    if (current.highlight.length) v.addStyle({ index: current.highlight }, { sphere: { scale: .34, color: '#15b8a6', opacity: .65 } });
    v.removeAllLabels();
    if (current.labels) v.addPropertyLabels('elem', current.hydrogens ? {} : { not: { elem: 'H' } }, { fontSize: 13, backgroundOpacity: .6, fontColor: current.dark ? '#ffffff' : '#142d2b', backgroundColor: current.dark ? '#162323' : '#ffffff' });
    v.render();
  }
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    setError(''); setAtom(null);
    void (async () => {
      try {
        const canvas = document.createElement('canvas');
        if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) throw new Error('WebGL is unavailable in this browser. You can still explore the 2D views.');
        const module = await import('3dmol');
        if (disposed || !host.current) return;
        host.current.replaceChildren();
        const v = module.createViewer(host.current, { backgroundColor: dark ? '#162323' : '#f6f8f5', antialias: true }) as unknown as GLViewer;
        viewer.current = v;
        v.addModel(sdf, 'sdf');
        applySettings(v);
        v.setClickable({}, true, selected => setAtom(selected));
        v.zoomTo(); v.render();
        observer = new ResizeObserver(() => { v.resize(); v.render(); });
        observer.observe(host.current);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : 'The 3D renderer could not start. Please use 2D view.');
      }
    })();
    const container = host.current;
    return () => {
      disposed = true; observer?.disconnect(); viewer.current?.clear(); viewer.current = null;
      container?.querySelectorAll('canvas').forEach(canvas => {
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      });
      container?.replaceChildren();
    };
  }, [sdf]);
  useEffect(() => { if (viewer.current) applySettings(viewer.current); }, [dark, hydrogens, labels, highlight.join(',')]);
  return <div className="molecule-3d">
    <div ref={host} className="webgl-host" role="img" aria-label="Interactive ball-and-stick molecule. Drag to rotate; scroll to zoom." />
    {error ? <div className="viewer-fallback" role="status"><AlertCircle size={25}/><p>{error}</p></div> : <>
      <span className="canvas-label">BALL & STICK <i/> {atom ? `${atom.elem} · atom ${atom.index + 1}` : 'DRAG TO ROTATE'}</span>
      <div className="canvas-actions">{controlError && <span className="control-error" role="status">{controlError}</span>}<button className="icon-button" aria-label="Reset molecule view" onClick={() => { viewer.current?.zoomTo(); viewer.current?.render(); }}><RotateCcw size={17}/></button><button className="icon-button" aria-label="Expand molecule viewer" onClick={() => {
        const container = host.current?.parentElement;
        if (!container?.requestFullscreen) { setControlError('Fullscreen unavailable'); return; }
        void container.requestFullscreen().catch(() => setControlError('Fullscreen unavailable'));
      }}><Maximize2 size={17}/></button></div>
    </>}
  </div>;
}
