import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { api } from './api';
import { modelLabel, personalGenerate, useModel } from './model';

export default function ModelSettings({ open, close }: { open: boolean; close: () => void }) {
  const { settings, save } = useModel(); const [draft, setDraft] = useState(settings);
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [checking, setChecking] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => { if (open) { setDraft(settings); setNotice(''); dialog.current?.showModal(); } else { dialog.current?.close(); controller.current?.abort(); } }, [open, settings]);
  useEffect(() => () => controller.current?.abort(), []);
  function valid() {
    if (draft.provider === 'gemini' && !draft.apiKey.trim()) throw new Error('Enter your Gemini API key.');
    if (draft.provider !== 'host' && !draft.model.trim()) throw new Error('Enter a model name.');
    if (draft.provider === 'selfhost') {
      const url = new URL(draft.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTP(S) base URL without credentials or a query.');
    }
  }
  async function check() {
    try {
      valid(); setChecking(true); setNotice(''); controller.current = new AbortController();
      if (draft.provider === 'host') {
        const health = await api<{ gemma_configured: boolean }>('/health', undefined, controller.current.signal);
        setNotice(health.gemma_configured ? 'The host has configured an API key. Model access is checked on your next request.' : 'The host has not configured a key. Choose your own provider.');
      } else {
        await personalGenerate(draft, 'Reply only with OK.', [{ role: 'user', text: 'Connection check' }], controller.current.signal);
        setNotice('Connection successful. Your model responded.');
      }
    } catch (error) { if (!controller.current?.signal.aborted) setNotice(error instanceof Error ? error.message : 'Could not connect.'); }
    finally { setChecking(false); }
  }
  return <dialog ref={dialog} className="guide-dialog settings-dialog" onCancel={close} onClick={e => { if (e.target === dialog.current) close(); }} aria-labelledby="settings-title"><form className="guide-content" onSubmit={e => { e.preventDefault(); try { valid(); save({ ...draft, model: draft.model.trim(), apiKey: draft.apiKey.trim(), baseUrl: draft.baseUrl.trim() }); close(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Check these settings.'); } }}>
    <button type="button" className="icon-button guide-close" onClick={close} aria-label="Close model settings"><X size={21}/></button><span className="eyebrow">YOUR CONNECTION</span><h2 id="settings-title">Choose your Gemma.</h2><p>Use the host’s connection, your Gemini API key, or a model running on your own server.</p>
    <label className="settings-field">Model provider<select value={draft.provider} onChange={e => { const provider = e.target.value as typeof draft.provider; setDraft({ ...draft, provider, apiKey: '', model: provider === 'selfhost' ? 'gemma4:latest' : 'gemma-4-26b-a4b-it' }); setNotice(''); }}><option value="host">Host’s Gemma</option><option value="gemini">My Gemini API key</option><option value="selfhost">My self-hosted model</option></select></label>
    {draft.provider !== 'host' && <><label className="settings-field">Model name<input required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })}/></label>{draft.provider === 'selfhost' && <label className="settings-field">OpenAI-compatible base URL<input required type="url" placeholder="http://localhost:11434/v1" value={draft.baseUrl} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })}/><small>Include /v1, without /chat/completions. Works with Ollama, LM Studio, and vLLM when browser access is enabled.</small></label>}<label className="settings-field">{draft.provider === 'gemini' ? 'Gemini API key' : 'API key (optional)'}<input type="password" autoComplete="off" required={draft.provider === 'gemini'} value={draft.apiKey} onChange={e => setDraft({ ...draft, apiKey: e.target.value })}/></label><p className="settings-privacy">Your credentials stay in this page’s memory and are sent directly to your selected model endpoint. They are cleared on reload and are never sent to the app’s backend.</p>{draft.provider === 'selfhost' && <p className="settings-help">Your server must allow this website’s origin through CORS. For Ollama, include <code>{window.location.origin}</code> in <code>OLLAMA_ORIGINS</code>. An HTTPS website needs an endpoint the browser permits it to reach.</p>}</>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}<div className="settings-actions"><button type="button" className="small-button" disabled={checking} onClick={() => void check()}>{checking && <LoaderCircle size={16} className="spin"/>}{checking ? 'Checking…' : 'Check connection'}</button><button className="primary-button" disabled={checking}><CheckCircle2 size={16}/> Use {modelLabel(draft)}</button></div>
  </form></dialog>;
}
