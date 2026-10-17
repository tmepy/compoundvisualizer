import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RichText from './RichText';

describe('generated Markdown', () => {
  it('renders headings, emphasis, and separated list items', () => {
    const html = renderToStaticMarkup(<RichText text={'### Chemical feedstock\nMethane is **useful**.\n\n* Hydrogen\n* Methanol\n\n1. First\n2. Second'}/>);
    expect(html).toContain('<h4>Chemical feedstock</h4>');
    expect(html).toContain('<strong>useful</strong>');
    expect(html).toContain('<ul>'); expect(html).toContain('<ol start="1">');
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).not.toContain('###');
  });
  it('renders nested lists, tables and code without interpreting raw HTML', () => {
    const html = renderToStaticMarkup(<RichText text={'- Parent\n  - Child\n\n| Name | Value |\n| --- | --- |\n| Formula | CH4 |\n\n```html\n<script>alert(1)</script>\n```'}/>);
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>CH4</td>');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  });
  it('keeps unsafe URLs inert and supports source links', () => {
    const html = renderToStaticMarkup(<RichText text={'[Unsafe](javascript:alert) [Source](https://pubchem.ncbi.nlm.nih.gov/compound/297) <img src=x onerror=alert(1)>'}/>);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://pubchem.ncbi.nlm.nih.gov/compound/297"');
    expect(html).not.toContain('<img');
  });
});
