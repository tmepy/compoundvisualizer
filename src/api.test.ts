import { describe, expect, it } from 'vitest';
import { groupCandidates, streamLines } from './api';

describe('ranked candidates', () => {
  it('preserves model preference order inside each category', () => {
    const items = [{ category: 'organic' as const, rank: 1 }, { category: 'inorganic' as const, rank: 2 }, { category: 'organic' as const, rank: 3 }];
    const grouped = groupCandidates(items);
    expect(grouped.organic.map(x => x.rank)).toEqual([1, 3]);
    expect(grouped.inorganic.map(x => x.rank)).toEqual([2]);
  });
  it('does not force results into an empty category', () => {
    expect(groupCandidates([{ category: 'organic' as const }]).inorganic).toEqual([]);
  });
});

describe('chat stream framing', () => {
  it('retains a partial JSON event across network chunks', () => {
    const first = streamLines('{"text":"First"}\n{"te');
    expect(first.lines).toEqual(['{"text":"First"}']);
    const second = streamLines(first.rest + 'xt":"second"}\n{"done":true}\n');
    expect(second.lines.map(line => JSON.parse(line))).toEqual([{ text: 'second' }, { done: true }]);
    expect(second.rest).toBe('');
  });
  it('does not emit an unterminated event', () => {
    expect(streamLines('{"text":')).toEqual({ lines: [], rest: '{"text":' });
  });
});
