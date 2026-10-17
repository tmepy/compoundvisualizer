import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Atom, BookOpen, Check, CheckCircle2, ChevronDown, ExternalLink, FlaskConical, Layers3, Leaf, LoaderCircle, Moon, Search, SlidersHorizontal, Sparkles, Sun, X, Settings2 } from 'lucide-react';
import { api, groupCandidates } from './api';
import AutoTextarea from './AutoTextarea';
import ModelSettings from './ModelSettings';
import { generateSummary, identifyWithModel, modelLabel, useModel } from './model';
import Chat, { RichText } from './Chat';
import Viewer, { ELEMENT_COLORS } from './Viewer';
import type { ChatMessage, Compound, Identification, Projection, ProjectionKind, Structures, ViewMode } from './types';

const PROJECTIONS: { value: ProjectionKind; label: string }[] = [{ value: 'skeletal', label: 'Skeletal' }, { value: 'wedge', label: 'Wedge & dash' }, { value: 'newman', label: 'Newman' }, { value: 'sawhorse', label: 'Sawhorse' }, { value: 'fischer', label: 'Fischer' }];
const EXAMPLES = ['The stimulant in my morning coffee', 'A common painkiller derived from willow', 'A salt used in baking'];
const KNOWN = [{ cid: 2519, name: 'Caffeine', formula: 'C8H10N4O2', detail: 'The chemistry of your morning ritual', icon: '01', className: 'mint' }, { cid: 2244, name: 'Aspirin', formula: 'C9H8O4', detail: 'A familiar molecule with a rich history', icon: '02', className: 'peach' }, { cid: 107526, name: 'D-Glucose', formula: 'C6H12O6', detail: 'A small sugar that powers a living world', icon: '03', className: 'lavender' }];

function Formula({ value }: { value: string | null | undefined }) {
  if (!value) return <span>Unavailable</span>;
  return <span className="formula">{value.split(/(\d+)/).map((part, index) => /^\d+$/.test(part) ? <sub key={index}>{part}</sub> : <span key={index}>{part}</span>)}</span>;
}

function Loading({ children }: { children: React.ReactNode }) { return <div className="loading" role="status"><LoaderCircle className="spin" size={23}/><span>{children}</span></div>; }
function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) { return <div className="error-notice" role="alert"><p>{message}</p>{retry && <button className="text-button" onClick={retry}>Try again <ArrowRight size={14}/></button>}</div>; }

function MoleculeArt() {
  return <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-grid"/>
    <svg viewBox="0 0 520 430" className="hero-molecule"><defs><radialGradient id="carbon" cx="30%" cy="24%"><stop stopColor="#79a6a0"/><stop offset=".65" stopColor="#38635e"/><stop offset="1" stopColor="#254c47"/></radialGradient><radialGradient id="oxygen" cx="30%" cy="24%"><stop stopColor="#ffc1a5"/><stop offset=".7" stopColor="#e99375"/><stop offset="1" stopColor="#bc644e"/></radialGradient><radialGradient id="hydrogen" cx="30%" cy="24%"><stop stopColor="#fff"/><stop offset="1" stopColor="#cbd7cb"/></radialGradient><filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#194f47" floodOpacity=".16"/></filter></defs>
      <g fill="none" strokeLinecap="round" stroke="#a4bdb2" strokeWidth="11"><path d="m128 233 110-62 109 64 77-76M238 171l5-82M128 233l-46-58M128 233l-7 78M238 171l-2 110M347 235l30 81M347 235l-44 88M424 159l43-40"/></g>
      <g filter="url(#shadow)"><circle cx="82" cy="175" r="17" fill="url(#hydrogen)"/><circle cx="121" cy="311" r="19" fill="url(#hydrogen)"/><circle cx="243" cy="89" r="20" fill="url(#hydrogen)"/><circle cx="236" cy="281" r="19" fill="url(#hydrogen)"/><circle cx="303" cy="323" r="20" fill="url(#hydrogen)"/><circle cx="377" cy="316" r="20" fill="url(#hydrogen)"/><circle cx="467" cy="119" r="19" fill="url(#hydrogen)"/><circle cx="128" cy="233" r="31" fill="url(#carbon)"/><circle cx="238" cy="171" r="36" fill="url(#carbon)"/><circle cx="347" cy="235" r="34" fill="url(#carbon)"/><circle cx="424" cy="159" r="30" fill="url(#oxygen)"/></g>
    </svg><div className="art-note note-top"><span className="note-dot"/> A new perspective on chemistry</div><div className="art-note note-bottom"><Atom size={18}/><div>Small structures.<br/><strong>Endless discoveries.</strong></div></div><span className="art-caption">ILLUSTRATIVE MOLECULAR STUDY · NOT A COMPOUND RECORD</span></div>;
}

function Guide({ open, close }: { open: boolean; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <dialog ref={dialog} className="guide-dialog" onCancel={close} onClick={e => { if (e.target === dialog.current) close(); }} aria-labelledby="guide-title"><div className="guide-content"><button className="icon-button guide-close" onClick={close} aria-label="Close field guide"><X size={21}/></button><span className="eyebrow">A QUICK FIELD GUIDE</span><h2 id="guide-title">Follow your curiosity.</h2><p>Describe what you know: a use, a property, a familiar name. Gemma suggests possibilities; chemical data sources verify the records.</p><ol><li><strong>Start with a clue.</strong> More specific descriptions produce more useful matches.</li><li><strong>Explore the molecule.</strong> Rotate the ball-and-stick model or switch to 2D and projection views.</li><li><strong>Go a little deeper.</strong> Ask Gemma follow-up questions in the compound’s own conversation.</li></ol><h3>Reading the projections</h3><p><strong>Wedge & dash:</strong> solid wedges point toward you; dashed wedges point away. <strong>Newman:</strong> look along a selected carbon–carbon bond. <strong>Sawhorse:</strong> see that same bond at an oblique angle. <strong>Fischer:</strong> horizontal bonds point toward you and vertical bonds away.</p><p>Greyed-out views include a reason. Some require a 3D conformer, specified stereochemistry, or a structure supported by this version.</p><h3>Where the information comes from</h3><p>Names, properties, and coordinates come from <a href="https://pubchem.ncbi.nlm.nih.gov/" target="_blank" rel="noreferrer">PubChem</a>, with <a href="https://cactus.nci.nih.gov/chemical/structure_documentation" target="_blank" rel="noreferrer">NCI/CADD</a> as a fallback for unresolved structures. Calculated properties are labeled as RDKit computations. Gemma proposes candidates and explains the chemistry. Rankings express relevance, not measured confidence. Molecular conformers do not show a material’s crystal lattice.</p><button className="primary-button" onClick={close}>Let’s explore <ArrowRight size={17}/></button></div></dialog>;
}

function Workbench({ compound, dark, messages, onMessages, onSelect }: { compound: Compound; dark: boolean; messages: ChatMessage[]; onMessages: (messages: ChatMessage[]) => void; onSelect: (cid: number) => void }) {
  const { settings } = useModel();
  const [summaryBusy, setSummaryBusy] = useState(true);
  const [structures, setStructures] = useState<Structures | null>(null);
  const [structureError, setStructureError] = useState('');
  const [structureAttempt, setStructureAttempt] = useState(0);
  const [summary, setSummary] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const [mode, setMode] = useState<ViewMode>('3d');
  const [kind, setKind] = useState<ProjectionKind>('skeletal');
  const [projection, setProjection] = useState<Projection | null>(null);
  const [projectionError, setProjectionError] = useState('');
  const [projectionAttempt, setProjectionAttempt] = useState(0);
  const [bond, setBond] = useState<number | undefined>();
  const [reverse, setReverse] = useState(false);
  const [hydrogens, setHydrogens] = useState(true);
  const [labels, setLabels] = useState(false);
  const [elementColors, setElementColors] = useState(ELEMENT_COLORS);
  const [mobileTab, setMobileTab] = useState<'molecule' | 'chat'>('molecule');

  useEffect(() => {
    let mounted = true;
    void import('3dmol').then(module => {
      if (mounted && module.elementColors?.Jmol) setElementColors(Object.fromEntries(Object.entries(module.elementColors.Jmol).map(([symbol, color]) => [symbol, `#${color.toString(16).padStart(6, '0')}`])));
    }).catch(() => { /* The known-element key remains available if the renderer cannot load. */ });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setStructureError('');
    void api<Structures>(`/compounds/${compound.cid}/structures`, undefined, controller.signal).then(data => { setStructures(data); if (!data.sdf) setMode('2d'); setBond(data.bonds[0]?.id); }).catch(e => { if (!controller.signal.aborted) setStructureError(e.message); });
    return () => controller.abort();
  }, [compound.cid, structureAttempt]);
  useEffect(() => {
    const controller = new AbortController(); setSummaryError(''); setSummary(''); setSummaryBusy(true);
    void generateSummary(compound, settings, controller.signal, setSummary).then(setSummary).catch(e => { if (!controller.signal.aborted) setSummaryError(e.message); }).finally(() => { if (!controller.signal.aborted) setSummaryBusy(false); });
    return () => controller.abort();
  }, [compound.cid, summaryAttempt, settings]);
  useEffect(() => {
    if (!structures) return;
    const controller = new AbortController(); setProjection(null); setProjectionError('');
    void api<Projection>(`/compounds/${compound.cid}/projections`, { kind, bond, reverse }, controller.signal).then(setProjection).catch(e => { if (!controller.signal.aborted) setProjectionError(e.message); });
    return () => controller.abort();
  }, [compound.cid, structures, kind, bond, reverse, projectionAttempt]);

  const needsBond = kind === 'newman' || kind === 'sawhorse';
  const highlight = needsBond ? structures?.bonds.find(b => b.id === bond)?.atoms ?? [] : [];
  const properties: [string, string, string?][] = [['Molecular weight', 'MolecularWeight', 'g/mol'], [compound.properties.LogP !== undefined ? 'LogP (Crippen)' : 'XLogP', compound.properties.LogP !== undefined ? 'LogP' : 'XLogP'], ['Polar surface area', 'TPSA', 'Å²'], ['H-bond donors', 'HBondDonorCount'], ['H-bond acceptors', 'HBondAcceptorCount'], ['Formal charge', 'Charge']];
  return <>
    <div className="compound-title-row"><div><div className="eyebrow"><span className="status-dot"/> VERIFIED {(compound.source_label ?? 'PubChem').toUpperCase()} RECORD <span className="eyebrow-divider">/</span> {compound.cid > 0 ? `CID ${compound.cid}` : 'ALTERNATE SOURCE'}</div><h1>{compound.name}</h1><p className="iupac"><span>IUPAC</span> {compound.iupac ?? 'Name unavailable'}</p></div><div className="compound-identity"><Formula value={compound.formula}/><a href={compound.source} target="_blank" rel="noreferrer">View source <ExternalLink size={13}/></a></div></div>
    {compound.forms && compound.forms.length > 0 && <div className="molecular-form"><label htmlFor="molecular-form">Molecular form<select id="molecular-form" value={compound.cid} onChange={e => onSelect(Number(e.target.value))}>{!compound.forms.some(f => f.cid === compound.cid) && <option value={compound.cid}>Current source record</option>}{compound.forms.map(form => <option key={form.cid} value={form.cid}>{form.label}</option>)}</select></label><p>Open-chain and ring forms have different structures. Choose the form you want to explore.</p></div>}
    {compound.record_note && <div className="structure-note">{compound.record_note}</div>}
    <div className="mobile-workspace-tabs"><button className={mobileTab === 'molecule' ? 'active' : ''} onClick={() => setMobileTab('molecule')}><Atom size={16}/> Molecule</button><button className={mobileTab === 'chat' ? 'active' : ''} onClick={() => setMobileTab('chat')}><Sparkles size={16}/> Ask Gemma</button></div>
    <div className={`workspace-grid mobile-${mobileTab}`}>
      <section className="structure-panel" aria-label="Molecular structure">
        <div className="panel-heading"><div><Atom size={18}/><h2>Molecular explorer</h2></div><div className="segmented" aria-label="Molecule view">{(['3d', '2d', 'split'] as ViewMode[]).map(view => <button key={view} aria-pressed={mode === view} className={mode === view ? 'active' : ''} disabled={view !== '2d' && !structures?.sdf} onClick={() => setMode(view)}>{view === 'split' && <Layers3 size={13}/>} {view === 'split' ? 'Split' : view.toUpperCase()}</button>)}</div></div>
        {structureError ? <ErrorNotice message={structureError} retry={() => setStructureAttempt(a => a + 1)}/> : !structures ? <Loading>Retrieving the molecular structure…</Loading> : <>
          {structures.disconnected && <div className="structure-note">This record contains disconnected fragments or ions. These views do not depict a crystal lattice.</div>}
          {structures.unavailable_reason && <div className="structure-note">{structures.unavailable_reason}</div>}
          {structures.warnings.map(w => <div className="structure-note" key={w}>{w}</div>)}
          <div className={`molecule-stage mode-${mode}`}>
            {mode !== '2d' && structures.sdf && <Viewer sdf={structures.sdf} dark={dark} hydrogens={hydrogens} labels={labels} highlight={highlight}/>}
            {mode !== '3d' && <div className="molecule-2d">{projectionError ? <ErrorNotice message={projectionError} retry={() => setProjectionAttempt(a => a + 1)}/> : projection ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(projection.svg)}`} alt={`${PROJECTIONS.find(p => p.value === kind)?.label} representation of ${compound.name}`}/> : <Loading>Drawing projection…</Loading>}<span className="canvas-label">{PROJECTIONS.find(p => p.value === kind)?.label.toUpperCase()} VIEW</span></div>}
          </div>
          {mode !== '3d' && <div className="projection-controls"><div className="projection-select"><label htmlFor="projection-select">Representation</label><div className="select-wrap"><select id="projection-select" value={kind} onChange={e => setKind(e.target.value as ProjectionKind)}>{PROJECTIONS.map(p => <option value={p.value} key={p.value} disabled={!structures.projections[p.value].enabled}>{p.label}{!structures.projections[p.value].enabled ? ' — unavailable' : ''}</option>)}</select><ChevronDown size={14}/></div></div>{needsBond && <><label className="bond-select">Viewing bond<select value={bond} onChange={e => setBond(Number(e.target.value))}>{structures.bonds.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label><button className="small-button" onClick={() => setReverse(r => !r)}>Reverse direction ⇄</button></>}
            <details className="projection-help"><summary>View availability</summary><ul>{PROJECTIONS.map(p => <li key={p.value}><strong>{p.label}</strong><span>{structures.projections[p.value].enabled ? 'Available for this structure' : structures.projections[p.value].reason}</span></li>)}</ul></details>
          </div>}
          {mode !== '3d' && projection && <p className="projection-caption">{projection.caption}</p>}
          <div className="viewer-footer"><div className="element-legend" aria-label="Jmol element color key">{structures.elements.map(element => <span key={element}><i style={{ background: elementColors[element] ?? elementColors[element.toUpperCase()] ?? '#ff1493' }}/>{element}</span>)}<span className="legend-label">JMOL COLORS</span></div>{mode !== '2d' && <div className="viewer-toggles"><label><input type="checkbox" checked={hydrogens} onChange={e => setHydrogens(e.target.checked)}/> Hydrogens</label><label><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)}/> Labels</label></div>}</div>
        </>}
      </section>
      <Chat compound={compound} messages={messages} onMessages={onMessages}/>
    </div>
    <div className="details-grid"><section className="summary-panel"><div className="section-title"><span className="section-icon"><Sparkles size={18}/></span><h2>The bigger picture</h2><span className="ai-label">GEMMA SUMMARY</span></div>{summary && <RichText text={summary}/>} {summaryError ? <ErrorNotice message={summaryError} retry={() => setSummaryAttempt(a => a + 1)}/> : summaryBusy && <Loading><span className="summary-generating">Summary is being generated…</span></Loading>}<div className="source-list">{(compound.sources ?? [{ label: compound.source_label ?? 'PubChem', url: compound.source }]).map(source => <a key={source.url} className="source-link" href={source.url} target="_blank" rel="noreferrer">Evidence: {source.label} <ExternalLink size={12}/></a>)}</div></section>
      <section className="properties-panel"><div className="section-title"><span className="section-icon"><SlidersHorizontal size={17}/></span><h2>Chemical profile</h2><span className="ai-label">{compound.source_label ?? 'PubChem'}</span></div><dl className="properties-grid">{properties.map(([label, key, unit]) => <div key={key}><dt>{label}{compound.computed_fields?.includes(key) && <span className="computed-marker"> · computed</span>}</dt><dd>{compound.properties[key] ?? <span className="unavailable">Unavailable</span>}{compound.properties[key] !== undefined && unit && <small> {unit}</small>}</dd></div>)}</dl><details className="identifiers"><summary>Technical identifiers <ChevronDown size={14}/></summary><dl><dt>InChIKey</dt><dd>{compound.properties.InChIKey ?? 'Unavailable'}</dd><dt>Isomeric SMILES</dt><dd>{compound.properties.SMILES ?? compound.properties.IsomericSMILES ?? 'Unavailable'}</dd></dl></details></section></div>
  </>;
}

function CompoundWorkspace({ cid, dark, messages, onMessages, onSelect }: { cid: number; dark: boolean; messages: ChatMessage[]; onMessages: (messages: ChatMessage[]) => void; onSelect: (cid: number) => void }) {
  const [compound, setCompound] = useState<Compound | null>(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void api<Compound>(`/compounds/${cid}`, undefined, controller.signal).then(setCompound).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [cid, attempt]);
  return error ? <ErrorNotice message={error} retry={() => setAttempt(a => a + 1)}/> : compound ? <Workbench key={cid} compound={compound} dark={dark} messages={messages} onMessages={onMessages} onSelect={onSelect}/> : <Loading>Opening your compound…</Loading>;
}

export default function App() {
  const { settings, revision } = useModel();
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [dark, setDark] = useState(() => { try { const saved = localStorage.getItem('atlas-theme'); return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } });
  const [guide, setGuide] = useState(false);
  const [description, setDescription] = useState('');
  const [results, setResults] = useState<Identification | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [chats, setChats] = useState<Record<number, ChatMessage[]>>({});
  const [health, setHealth] = useState<'loading' | 'online' | 'unconfigured' | 'offline'>('loading');
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchAbort = useRef<AbortController | null>(null);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('atlas-theme', dark ? 'dark' : 'light'); } catch { /* Preferences are optional in restricted browsers. */ } }, [dark]);
  useEffect(() => { void api<{ gemma_configured: boolean }>('/health').then(data => setHealth(data.gemma_configured ? 'online' : 'unconfigured')).catch(() => setHealth('offline')); return () => searchAbort.current?.abort(); }, []);
  useEffect(() => { if (results || searching) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [results, searching]);
  useEffect(() => { searchAbort.current?.abort(); setSearching(false); }, [revision]);
  async function search() {
    if (description.trim().length < 3 || searching) return;
    const controller = new AbortController(); searchAbort.current = controller;
    setSearching(true); setError(''); setResults(null);
    try { setResults(await identifyWithModel(description.trim(), settings, controller.signal)); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Identification failed. Please try again.'); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  function addClue(label: string, value: string) {
    setDescription(current => {
      const existing = new RegExp(`${label}: [^\\n.]+\\.?`, 'i');
      const clue = `${label}: ${value}.`;
      return (existing.test(current) ? current.replace(existing, clue) : `${current.trim()}\n${clue}`).slice(0, 2000);
    });
    const input = document.getElementById('description'); input?.focus(); input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const groups = groupCandidates(results?.candidates ?? []);
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><button className="brand" onClick={() => setSelected(null)} aria-label="Compound Atlas home"><span className="brand-symbol"><Atom size={23} strokeWidth={1.6}/></span><span>compound<span className="brand-light">atlas</span><span className="brand-period">.</span></span></button><nav aria-label="Main navigation"><button className={!guide ? 'nav-link active' : 'nav-link'} onClick={() => { setSelected(null); setGuide(false); }}>Explore</button><button className="nav-link" onClick={() => setGuide(true)}><BookOpen size={15}/> Field guide</button></nav><div className="header-actions"><button aria-label="Model settings" className="model-settings-button" onClick={() => setModelSettingsOpen(true)}><Settings2 size={17}/><span>Model settings</span></button><button className="theme-switch" aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={() => setDark(d => !d)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button></div></header>
    <main id="main" className={selected ? 'workspace-main' : 'explore-main'}>
      {selected ? <><div className="workspace-nav"><button className="text-button" onClick={() => setSelected(null)}><ArrowLeft size={15}/> Back to exploration</button><span>EXPLORE / COMPOUND</span></div>{results && results.candidates.filter(c => c.verified).length > 1 && <div className="compound-switcher" aria-label="Other search results">{results.candidates.filter(c => c.verified).map(c => <button key={c.cid} className={selected === c.cid ? 'active' : ''} onClick={() => setSelected(c.cid)}>{c.name}</button>)}</div>}<CompoundWorkspace key={`${selected}-${revision}`} onSelect={setSelected} cid={selected} dark={dark} messages={chats[selected] ?? []} onMessages={messages => setChats(current => ({ ...current, [selected]: messages }))}/></> : <>
        <section className="hero"><div className="hero-copy"><div className="hero-eyebrow"><span className="tiny-sparkle">✦</span> CHEMISTRY, WITHOUT THE GUESSWORK</div><h1>Every compound<br/>has a story.<br/><em>Find yours.</em></h1><p>Start with what you know. Discover the molecule behind it.<br className="desktop-break"/> Explore its structure, understand its properties, and keep asking why.</p><a className="hero-jump" href="#discovery">Make a discovery <ArrowDown size={16}/></a></div><MoleculeArt/></section>
        <section className="discovery" id="discovery" aria-labelledby="discovery-heading"><div className="discovery-heading"><div><span className="eyebrow">YOUR NEXT DISCOVERY STARTS HERE</span><h2 id="discovery-heading">What compound is on your mind?</h2></div><span className="powered-label"><Sparkles size={14}/> {modelLabel(settings)}</span></div><form className="search-form" onSubmit={e => { e.preventDefault(); void search(); }}><div className="search-input"><Search size={22}/><label className="sr-only" htmlFor="description">Describe the compound</label><AutoTextarea id="description" rows={2} maxLength={2000} placeholder="Describe a compound, its properties, or where you’ve seen it…" value={description} onChange={e => setDescription(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void search(); } }}/><button className="primary-button" disabled={description.trim().length < 3 || searching}>{searching ? <LoaderCircle className="spin" size={18}/> : <Sparkles size={17}/>}<span>{searching ? 'Identifying…' : 'Find compounds'}</span>{!searching && <ArrowRight size={16}/>}</button></div><div className="search-bottom"><span><CheckCircle2 size={13}/> Natural language in. Real chemistry out.</span><span>Enter to search <kbd>↵</kbd></span></div></form><div className="example-prompts"><span>TRY A CLUE</span>{EXAMPLES.map(example => <button key={example} onClick={() => { setDescription(example); document.getElementById('description')?.focus(); }}>{example}<span>↗</span></button>)}</div>{error && <ErrorNotice message={error} retry={() => void search()}/>}</section>
        <div ref={resultsRef} className="results-anchor">{searching ? <div className="identifying-state"><span className="identifying-symbol"><Atom className="slow-spin" size={30}/></span><div><h3>Following the chemistry…</h3><p>Gemma is finding possibilities. Chemical data sources will check the records.</p></div><LoaderCircle className="spin" size={20}/></div> : results && <section className="results" aria-labelledby="results-heading"><div className="results-heading"><div><span className="eyebrow">FROM CLUE TO COMPOUND</span><h2 id="results-heading">{results.clarification ? 'Let’s narrow it down.' : 'A few possibilities to explore.'}</h2></div>{!results.clarification && <span>{results.candidates.length} candidates · ranked by relevance</span>}</div>{results.clarification ? <div className="clarification"><div className="clarification-question"><Sparkles size={21}/><p>{results.clarification}</p></div><div className="clarification-suggestions"><span>Add a detail to your description</span>{[{ label: 'Physical state', values: ['solid', 'liquid', 'gas'] }, { label: 'Functional group', values: ['alcohol', 'carboxylic acid', 'ketone'] }].map(group => <div className="clue-group" key={group.label}><strong>{group.label}</strong>{group.values.map(value => <button key={value} onClick={() => addClue(group.label, value)}>+ {value}</button>)}</div>)}<p>Choose only details you know. Then search again.</p></div></div> : <div className="results-columns">{(['organic', 'inorganic'] as const).map(category => <div className="result-column" key={category}><div className="column-heading">{category === 'organic' ? <Leaf size={18}/> : <FlaskConical size={18}/>}<h3>{category === 'organic' ? 'Organic' : 'Inorganic'}</h3><span>{groups[category].length}</span></div>{groups[category].length ? groups[category].map((candidate, i) => <button className="candidate-card" disabled={!candidate.verified} key={`${candidate.name}-${candidate.rank}`} onClick={() => setSelected(candidate.cid)}><div className="candidate-rank">{String(candidate.rank).padStart(2, '0')}</div><div className="candidate-body"><div className="candidate-top"><h4>{candidate.name}</h4>{i === 0 && <span className="match-label">TOP IN CATEGORY</span>}</div><Formula value={candidate.formula}/><p>{candidate.reason}</p><span className={candidate.verified ? 'verified-note' : 'unverified-note'}>{candidate.verified ? <><Check size={12}/> {candidate.source_label ?? 'PubChem'} verified</> : candidate.verification_note ?? 'Unverified candidate'}</span></div>{candidate.verified && <ArrowRight size={18}/>}</button>) : <div className="empty-column">No {category} candidates matched this description.</div>}</div>)}</div>}{results.warnings.length > 0 && <div className="structure-note" role="status">Source lookup notes: {results.warnings.join(' ')}</div>}<p className="results-footnote">These are suggestions based on your description. Select a verified record to explore its chemistry.</p></section>}</div>
        <section className="known-section"><div className="known-heading"><h2>Or, meet a familiar molecule.</h2><span>No description needed <ArrowRight size={14}/></span></div><div className="known-grid">{KNOWN.map(item => <button className={`known-card ${item.className}`} key={item.cid} onClick={() => setSelected(item.cid)}><span className="known-number">{item.icon} / COMPOUND STUDY</span><div className="known-card-top"><h3>{item.name}</h3><span className="known-arrow"><ArrowRight size={18}/></span></div><span className="known-formula"><Formula value={item.formula}/></span><p>{item.detail}</p><span className="known-open">Explore molecule <ArrowRight size={13}/></span></button>)}</div></section>
        <div className="how-it-works"><span>ONE SMALL CLUE. THREE WAYS TO UNDERSTAND.</span><div><p><i>01</i> Describe it</p><span>→</span><p><i>02</i> See the structure</p><span>→</span><p><i>03</i> Ask the next question</p></div></div>
      </>}
    </main><footer className="site-footer"><div><Atom size={16}/><span>Built for the curious.</span></div><span>Open data from <a href="https://pubchem.ncbi.nlm.nih.gov/" target="_blank" rel="noreferrer">PubChem <ExternalLink size={11}/></a> and <a href="https://cactus.nci.nih.gov/chemical/structure_documentation" target="_blank" rel="noreferrer">NCI/CADD</a> <i>·</i> Explanations by Gemma 4</span><span className={`connection-status ${health}`}><i/>{settings.provider !== 'host' ? modelLabel(settings) : health === 'online' ? 'Gemma key configured' : health === 'unconfigured' ? 'Gemma key not configured' : health === 'offline' ? 'Backend offline' : 'Checking connection'}</span></footer><Guide open={guide} close={() => setGuide(false)}/><ModelSettings open={modelSettingsOpen} close={() => setModelSettingsOpen(false)}/>
  </div>;
}
