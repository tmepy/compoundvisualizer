import { expect, test, type Page } from '@playwright/test';

const options = {
  skeletal: { enabled: true, reason: null },
  wedge: { enabled: false, reason: 'No specified stereochemistry; use the skeletal view.' },
  newman: { enabled: false, reason: 'No matching 3D conformer is available.' },
  sawhorse: { enabled: false, reason: 'No matching 3D conformer is available.' },
  fischer: { enabled: false, reason: 'No tetrahedral stereocenters are present.' },
};

async function mockAPI(page: Page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/health') return json({ status: 'ok', gemma_configured: true });
    if (path === '/api/identify' || path === '/api/identify/resolve') return json({ clarification: null, warnings: [], candidates: [
      { name: 'Ethanol', cid: 702, category: 'organic', rank: 1, reason: 'A common solvent.', formula: 'C2H6O', verified: true },
      { name: 'Water', cid: 962, category: 'inorganic', rank: 2, reason: 'A familiar inorganic solvent.', formula: 'H2O', verified: true },
      { name: 'Unresolved suggestion', cid: null, category: 'organic', rank: 3, reason: 'Needs verification.', verified: false, verification_note: 'No matching PubChem record found.' },
    ] });
    const cid = Number(path.match(/compounds\/(\d+)/)?.[1]);
    if (path.endsWith('/structures')) return json({ sdf: null, projections: options, bonds: [], elements: ['C', 'H', 'O'], disconnected: false, warnings: [], unavailable_reason: 'No matching PubChem 3D conformer is available.' });
    if (path.endsWith('/projections')) return json({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text x="50" y="50">Structure fixture</text></svg>', highlight: [], caption: 'Structure depiction from a mocked source.' });
    if (path.endsWith('/summary')) return json({ text: 'A clear explanation based on the retrieved record. [PubChem](https://pubchem.ncbi.nlm.nih.gov/compound/702)' });
    if (path.endsWith('/summary/stream')) return route.fulfill({ contentType: 'application/x-ndjson', body: '{"text":"A clear explanation based on the retrieved record."}\n{"done":true}\n' });
    if (path.endsWith('/chat')) return route.fulfill({ contentType: 'application/x-ndjson', body: '{"text":"A compound-specific explanation."}\n{"done":true}\n' });
    return json({ cid, name: cid === 702 ? 'Ethanol' : 'Water', iupac: cid === 702 ? 'ethanol' : 'oxidane', formula: cid === 702 ? 'C2H6O' : 'H2O', source: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`, properties: { MolecularWeight: '46.07', HBondDonorCount: 1, HBondAcceptorCount: 1, Charge: 0 } });
  });
}

async function search(page: Page) {
  await page.goto('/');
  await page.getByLabel('Describe the compound').fill('A common solvent');
  await page.getByRole('button', { name: 'Find compounds' }).click();
  await expect(page.getByRole('heading', { name: 'A few possibilities to explore.' })).toBeVisible();
}

test.beforeEach(async ({ page }) => { await mockAPI(page); });

test('search, verified selection, projection fallback, and return preserve the query', async ({ page }) => {
  await search(page);
  await expect(page.getByRole('heading', { name: 'Organic', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inorganic', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Unresolved suggestion/ })).toBeDisabled();
  await page.getByRole('button', { name: /01 Ethanol/ }).click();
  await expect(page.getByRole('heading', { name: 'Ethanol', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
  await expect(page.getByRole('img', { name: /Skeletal representation/ })).toBeVisible();
  await page.getByText('View availability', { exact: true }).click();
  await expect(page.getByText('No tetrahedral stereocenters are present.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to exploration' }).click();
  await expect(page.getByLabel('Describe the compound')).toHaveValue('A common solvent');
});

test('chat remains scoped to each compound', async ({ page }) => {
  await search(page);
  await page.getByRole('button', { name: /01 Ethanol/ }).click();
  await page.getByLabel('Ask a follow-up question').fill('Explain the bonding');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('A compound-specific explanation.')).toBeVisible();
  await page.getByRole('button', { name: 'Water', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Water', exact: true })).toBeVisible();
  await expect(page.getByText('A compound-specific explanation.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ethanol', exact: true }).click();
  await expect(page.getByText('A compound-specific explanation.')).toBeVisible();
});

test('theme persists and field guide supports keyboard dismissal', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Field guide' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('mobile users can switch between the molecule and chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await search(page);
  await page.getByRole('button', { name: /01 Ethanol/ }).click();
  await expect(page.getByRole('heading', { name: 'Molecular explorer' })).toBeVisible();
  await page.getByRole('button', { name: 'Ask Gemma', exact: true }).click();
  await expect(page.getByLabel('Ask a follow-up question')).toBeVisible();
  await page.getByRole('button', { name: 'Molecule', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Molecular explorer' })).toBeVisible();
});

test('a missing API key yields an actionable error and a retry', async ({ page }) => {
  await page.route('**/api/identify', route => route.fulfill({ status: 503, json: { detail: 'Set GEMINI_API_KEY on the server.' } }));
  await page.goto('/');
  await page.getByLabel('Describe the compound').fill('The stimulant in coffee');
  await page.getByRole('button', { name: 'Find compounds' }).click();
  await expect(page.getByRole('alert')).toContainText('Set GEMINI_API_KEY');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('clarification chips edit the description and inputs grow with content', async ({ page }) => {
  await page.route('**/api/identify', route => route.fulfill({ json: { clarification: 'What is its physical state?', candidates: [], warnings: [] } }));
  await page.goto('/');
  const input = page.getByLabel('Describe the compound');
  const initial = await input.evaluate(element => element.getBoundingClientRect().height);
  await input.fill('An unfamiliar compound');
  await page.getByRole('button', { name: 'Find compounds' }).click();
  await page.getByRole('button', { name: '+ solid', exact: true }).click();
  await expect(input).toHaveValue('An unfamiliar compound\nPhysical state: solid.');
  await page.getByRole('button', { name: '+ liquid', exact: true }).click();
  await expect(input).toHaveValue('An unfamiliar compound\nPhysical state: liquid.');
  await input.fill('A description with multiple clues. '.repeat(35));
  expect(await input.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(initial);
});

test('familiar formulas use semantic subscripts and summaries render Markdown', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.known-card').first().locator('.formula sub')).toHaveText(['8', '10', '4', '2']);
  await page.route('**/api/compounds/*/summary/stream', async route => {
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ text: '### At a glance\nA **familiar** molecule.\n\n- First fact\n- Second fact' }) + '\n{"done":true}\n' });
  });
  await page.getByRole('button', { name: /Caffeine/ }).click();
  await expect(page.getByText('Summary is being generated…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  await expect(page.locator('.summary-panel li')).toHaveCount(2);
});

test('personal API keys go to Google and never to the application backend', async ({ page }) => {
  const backendBodies: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) backendBodies.push(request.postData() ?? ''); });
  let modelCalls = 0;
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-goog-api-key', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    modelCalls++;
    expect(route.request().headers()['x-goog-api-key']).toBe('browser-only-secret');
    const value = JSON.stringify({ clarification: null, candidates: [{ name: 'ethanol', category: 'organic', reason: 'A solvent.' }] });
    await route.fulfill({ headers, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: value }] }, finishReason: 'STOP' }] })}\n\n` });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await page.getByLabel('Model provider').selectOption('gemini');
  await page.getByLabel('Gemini API key', { exact: true }).fill('browser-only-secret');
  await page.getByRole('button', { name: 'Use Your Gemini API key', exact: true }).click();
  await page.getByLabel('Describe the compound').fill('a common solvent');
  await page.getByRole('button', { name: 'Find compounds' }).click();
  await expect(page.getByRole('heading', { name: 'A few possibilities to explore.' })).toBeVisible();
  expect(modelCalls).toBe(1);
  expect(backendBodies.join('')).not.toContain('browser-only-secret');
  await page.reload();
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await expect(page.getByLabel('Model provider')).toHaveValue('host');
});
