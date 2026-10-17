# Compound Atlas

A natural-language compound explorer for Hacktoberfest. Describe a compound, compare ranked organic and inorganic candidates, and explore verified chemical structures with Gemma follow-up questions.

## Run locally

Use Node.js 22 LTS and Python 3.12. The backend needs outbound HTTPS access to PubChem, NCI/CADD, and Google's Gemini API when using the host's model. Obtain a Gemini API key with access to Gemma 4 in [Google AI Studio](https://aistudio.google.com/), or configure a personal model connection in the website.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env
```

Put the host's key in `.env` as `GEMINI_API_KEY`. The optional `GEMMA_MODEL` defaults to `gemma-4-26b-a4b-it`. Host credentials stay on the server; never use a `VITE_` prefix for the key or commit `.env`. `GEMMA_THINKING_LEVEL` defaults to `minimal` to reduce generation work; set `high` if you prefer additional reasoning time.

Start the backend from the project root:

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to FastAPI. Familiar-molecule cards work without a model key. Identification, summaries, and chat use the host connection by default, or the personal connection selected in **Model settings**.

## Personal model connections

Choose **My Gemini API key** to call Google's Gemini API directly from your browser, or **My self-hosted model** to use an OpenAI-compatible streaming Chat Completions endpoint. For Ollama, use `http://localhost:11434/v1` and the exact name of your installed Gemma model. LM Studio and vLLM can also be used with their corresponding base URLs and model names. An optional bearer token is supported for self-hosted endpoints.

The model server must allow the website's origin through CORS. For example, when using Ollama locally, set `OLLAMA_ORIGINS=http://localhost:5173` in the environment that starts Ollama, then restart it. Use your actual website origin for other deployments. Browser HTTPS and local-network restrictions still apply.

Personal credentials and model settings stay in page memory and reset on reload. Keys are sent only to the selected model endpoint, never to FastAPI or browser storage. The app still calls FastAPI for public-data verification and deterministic chemistry rendering. **Check connection** sends a short test prompt for personal models; for the host it checks whether a key is configured.

To serve a production build from FastAPI, run `npm run build` and then restart the backend without `--reload`. It serves the frontend at **http://127.0.0.1:8000**. Docker and public deployment are deferred.

## What is included

- Light/dark themes, responsive layouts, organic/inorganic result columns, and PubChem verification. Ambiguous record matches remain unverified until the description is refined.
- Rotatable, zoomable WebGL ball-and-stick models with a Jmol color key, hydrogen visibility, atom labels, atom inspection, and reset/fullscreen controls.
- 3D, 2D, and split views with skeletal, wedge/dash, Newman, sawhorse, and Fischer representations. Newman and sawhorse share a bond selector and viewing-direction control.
- Sourced compound properties, Gemma summaries, and streaming chat kept separately for each compound during the browser session.
- An accessible field guide, source links, partial-data handling, throttled public API requests, and bounded in-memory caches.
- Markdown formatting for generated replies, a uniform Inter type scale, proper chemical subscripts, auto-growing inputs, and clickable clarification details.
- Streamed summaries with a blinking generation indicator. Host summary requests share in-flight work and cache completed results; the HTTP client reuses connections. Live latency depends on your provider and model.
- Explicit open-chain and cyclic choices for D-glucose and D-fructose. Broad sugar searches prefer open-chain records; requests specifying a ring form or L isomer retain that intent.

## Chemistry boundaries

Gemma proposes identities and explanations. PubChem supplies records, structures, and available conformers. [NCI/CADD](https://cactus.nci.nih.gov/chemical/structure_documentation) resolves structures when PubChem cannot verify a name or supply a structure. Alternate-source properties are computed with RDKit and labeled accordingly; measured values and IUPAC names are not invented. Missing or ambiguous stereochemistry remains unresolved. The app never uses model-generated coordinates or treats AI text as authoritative chemical data. RDKit appends hydrogens and places their coordinates on the retrieved heavy-atom conformer.

Wedge/dash preserves specified stereochemistry. Newman and sawhorse require a non-ring single bond between tetrahedral carbon atoms in a retrieved 3D conformer. Fischer supports a deliberately bounded subset: connected acyclic molecules with an unbranched carbon backbone, specified internal tetrahedral stereocenters, and simple side groups. Internal carbonyls are depicted explicitly, allowing supported open-chain ketoses such as D-fructose. Every Fischer cross is checked against RDKit's local stereo assignment. Unsupported projections stay disabled with reasons. Ring and chain forms use different source records; a ring record is never merely redrawn as an open chain.

Ordinary 2D skeletal drawings omit stereo marks by design; use wedge/dash to inspect configuration. A retrieved conformer is one possible geometry, not an energy calculation. Disconnected inorganic structures represent their recorded fragments or ions, not crystal lattices. Source structures above 300 heavy atoms are outside this version's viewer limit.

PubChem common titles are used as display names; an IUPAC name is displayed separately when supplied. Missing properties remain unavailable. No percentage confidence is assigned to AI rankings. Only the theme is stored persistently in the browser; chats, searches, and personal credentials stay in memory. Host public-data and summary caches expire after one hour; bounded NCI fallback records reset with the server.

## Tests

```bash
python -m pytest backend/tests -q
npm test
npm run build
```

For browser workflow tests with mocked APIs:

```bash
npx playwright install chromium
npm run test:e2e
```

Backend tests cover ranking and deduplication, ambiguous matches, malformed model JSON, partial API failures, streaming failures, source evidence, cache behavior, atom-order alignment, projection eligibility, and stereochemical fixtures. Frontend tests cover result grouping and streaming event framing. These tests mock external services; they do not spend API quota.

Browser tests cover verified selection, missing-conformer fallback, projection explanations, returning to results, compound-specific conversations, theme persistence, keyboard dismissal of the guide, mobile chat switching, and missing-key errors.

For a live smoke test, identify “the stimulant in coffee”, open caffeine, rotate its structure, compare 2D and split views, and ask a follow-up question. Open D-glucose to check applicable projections and disabled explanations. Repeat in both themes and at mobile width. Verify a fully specified open-chain glyceraldehyde record for Fischer, and butane for Newman/sawhorse and bond reversal.

## API

FastAPI's interactive schema is available at `/docs`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Backend readiness and whether a model key is configured |
| `POST /api/identify` | Description → ranked, verified candidates or clarification |
| `POST /api/identify/resolve` | Verify candidates generated by a personal browser model; accepts no API keys |
| `GET /api/compounds/{cid}` | PubChem identity and properties |
| `GET /api/compounds/{cid}/structures` | Atom-aligned 3D SDF and projection availability |
| `POST /api/compounds/{cid}/projections` | Validated SVG depiction, caption, and selected atom IDs |
| `GET /api/compounds/{cid}/summary` | Evidence-grounded Gemma summary |
| `GET /api/compounds/{cid}/summary/stream` | Stream or replay the cached host summary as newline-delimited JSON |
| `POST /api/compounds/{cid}/chat` | Newline-delimited JSON stream with `text`, `error`, and `done` events |

Atom IDs in the API are zero-based; viewer labels are one-based. One cached molecular graph defines the shared heavy-atom order across all views. Hydrogens are appended. Coordinates from a different stereoisomer are rejected.

Positive compound IDs are PubChem CIDs. Negative IDs identify bounded in-memory NCI fallback records, with explicit `source_label`, `sources`, and `computed_fields` metadata. Repeat the search if an alternate record expires after a server restart or cache eviction.

This is a local hackathon application. Public deployment, authentication, persistent accounts/history, and container packaging have not been configured.
