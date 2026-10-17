import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageCircle, Plus, Square, Sparkles } from 'lucide-react';
import RichText from './RichText';
export { default as RichText } from './RichText';
import AutoTextarea from './AutoTextarea';
import { generateChat, useModel } from './model';
import type { ChatMessage, Compound } from './types';

export default function Chat({ compound, messages, onMessages }: { compound: Compound; messages: ChatMessage[]; onMessages: (messages: ChatMessage[]) => void }) {
  const { settings } = useModel();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, partial]);
  async function send(question: string) {
    if (!question.trim() || busy) return;
    // Only complete exchanges enter history; interrupted replies never become model context.
    const next = [...messages, { role: 'user' as const, text: question.trim().slice(0, 6000) }];
    setInput(''); setPendingQuestion(question); setBusy(true); setError(''); setPartial('');
    const controller = new AbortController(); abort.current = controller;
    let answer = '';
    try {
      answer = await generateChat(compound, next, settings, controller.signal, setPartial);
      onMessages([...next, { role: 'model', text: answer }]); setPartial('');
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Chat is unavailable.');
      setInput(question); setPartial('');
    } finally { setBusy(false); abort.current = null; }
  }
  return <aside className="chat-panel" aria-label="Ask Gemma about this compound">
    <div className="chat-heading"><div className="chat-mark"><Sparkles size={18}/></div><div><h2>Ask Gemma</h2><span>Your chemistry companion</span></div><button className="icon-button" aria-label="Clear this compound's conversation" disabled={busy || !messages.length} onClick={() => onMessages([])}><Plus size={19}/></button></div>
    <div className="chat-context"><span className="status-dot"/> Discussing <strong>{compound.name}</strong></div>
    <div className="chat-scroll" aria-live="polite" aria-busy={busy}>
      {!messages.length && <div className="chat-welcome"><div className="chat-orbit"><MessageCircle size={26}/></div><h3>A little more curious?</h3><p>Let’s unpack the structure, properties, and chemistry of {compound.name}.</p><div className="suggested-questions">{['Explain this structure simply', 'What gives it its properties?', 'Where is this compound used?'].map(q => <button key={q} disabled={busy} onClick={() => void send(q)}>{q}<span>↗</span></button>)}</div></div>}
      {messages.map((message, i) => <div className={`chat-message ${message.role}`} key={i}><span className="message-author">{message.role === 'user' ? 'YOU' : 'GEMMA'}</span><RichText text={message.text}/></div>)}
      {busy && <><div className="chat-message user"><span className="message-author">YOU</span><p>{pendingQuestion}</p></div><div className="chat-message model"><span className="message-author">GEMMA</span>{partial ? <RichText text={partial}/> : <span className="thinking"><i/><i/><i/></span>}</div></>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div ref={end}/>
    </div>
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(input); }}><label className="sr-only" htmlFor="chat-input">Ask a follow-up question</label><AutoTextarea id="chat-input" placeholder="Ask a question about this compound…" value={input} maxLength={6000} rows={2} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}/><div><span>GEMMA 4 <i>✦</i></span>{busy ? <button type="button" className="send-button" aria-label="Stop response" onClick={() => abort.current?.abort()}><Square size={13}/></button> : <button className="send-button" aria-label="Send question" disabled={!input.trim()}><ArrowUp size={19}/></button>}</div></form>
    <p className="chat-footnote">AI explanations can be imperfect. Check the linked sources.</p>
  </aside>;
}
