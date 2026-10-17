import { Fragment, type ReactNode } from 'react';

// Render the Markdown used by model replies as React nodes. Raw HTML is always
// plain text, and links are limited to HTTP(S), mailto, or local anchors.
function inline(text: string, depth = 0): ReactNode {
  if (depth > 8) return text;
  const pattern = /(`[^`\n]+`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([^~]+)~~|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!\w)_([^_\n]+)_(?!\w))/g;
  const nodes: ReactNode[] = [];
  let previous = 0;
  for (const match of text.matchAll(pattern)) {
    nodes.push(text.slice(previous, match.index));
    const token = match[0];
    const key = match.index;
    if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (match[2] !== undefined) {
      const href = match[3];
      nodes.push(/^(https?:\/\/|mailto:|#)/i.test(href) ? <a key={key} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{inline(match[2], depth + 1)}</a> : <Fragment key={key}>{match[2]}</Fragment>);
    } else if (match[4] || match[5]) nodes.push(<strong key={key}>{inline(match[4] ?? match[5], depth + 1)}</strong>);
    else if (match[6]) nodes.push(<del key={key}>{inline(match[6], depth + 1)}</del>);
    else nodes.push(<em key={key}>{inline(match[7] ?? match[8], depth + 1)}</em>);
    previous = match.index! + token.length;
  }
  nodes.push(text.slice(previous));
  return nodes;
}

const listItem = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
const tableRule = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

function blocks(source: string, depth = 0): ReactNode[] {
  if (depth > 12) return [<p key="deep">{source}</p>];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let i = 0;
  const boundary = (index: number) => /^\s*$|^#{1,6}\s|^\s*```|^\s*>|^\s*(?:[-*_]\s*){3,}$/.test(lines[index]) || listItem.test(lines[index]) || (index + 1 < lines.length && tableRule.test(lines[index + 1]));
  while (i < lines.length) {
    const line = lines[i]; const key = i;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3); const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      nodes.push(<pre key={key}><code className={language ? `language-${language.replace(/[^\w-]/g, '')}` : undefined}>{code.join('\n')}</code></pre>); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const content = inline(heading[2]);
      // Chat headings stay below the page and panel headings in the hierarchy.
      nodes.push(heading[1].length <= 2 ? <h3 key={key}>{content}</h3> : <h4 key={key}>{content}</h4>); i++; continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { nodes.push(<hr key={key}/>); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''));
      nodes.push(<blockquote key={key}>{blocks(quoted.join('\n'), depth + 1)}</blockquote>); continue;
    }
    if (i + 1 < lines.length && line.includes('|') && tableRule.test(lines[i + 1])) {
      const header = cells(line); i += 2; const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      nodes.push(<div className="markdown-table" key={key}><table><thead><tr>{header.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{header.map((_, c) => <td key={c}>{inline(row[c] ?? '')}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const first = line.match(listItem);
    if (first) {
      const indent = first[1].length; const ordered = /^\d/.test(first[2]); const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = lines[i].match(listItem);
        if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
        const body = [item[3]]; i++;
        while (i < lines.length) {
          if (!lines[i].trim()) {
            if (i + 1 < lines.length && (lines[i + 1].match(listItem)?.[1].length ?? -1) === indent) { i++; break; }
            if (i + 1 < lines.length && (lines[i + 1].match(/^\s*/)?.[0].length ?? 0) > indent) { body.push(''); i++; continue; }
            break;
          }
          const next = lines[i].match(listItem);
          if (next && next[1].length <= indent) break;
          const spacing = lines[i].match(/^\s*/)?.[0].length ?? 0;
          if (spacing <= indent || /^\s*#{1,6}\s/.test(lines[i])) break;
          body.push(lines[i++].slice(Math.min(spacing, indent + 2)));
        }
        items.push(<li key={items.length}>{blocks(body.join('\n'), depth + 1)}</li>);
      }
      nodes.push(ordered ? <ol key={key} start={parseInt(first[2])}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && !boundary(i)) paragraph.push(lines[i++]);
    nodes.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return nodes;
}

export default function RichText({ text }: { text: string }) {
  return <div className="rich-text">{blocks(text)}</div>;
}
