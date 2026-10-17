export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status}). Please try again.`);
  }
  return response.json() as Promise<T>;
}

export function streamLines(buffer: string): { lines: string[]; rest: string } {
  const lines = buffer.split('\n');
  return { lines: lines.slice(0, -1).filter(Boolean), rest: lines.at(-1) ?? '' };
}

export function groupCandidates<T extends { category: 'organic' | 'inorganic' }>(items: T[]) {
  return { organic: items.filter(c => c.category === 'organic'), inorganic: items.filter(c => c.category === 'inorganic') };
}
