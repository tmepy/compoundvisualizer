import asyncio
import json
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .chemistry import availability, load_molecule, project
from .models import ChatRequest, IdentificationRequest, ProjectionRequest, ResolveRequest
from .services import evidence_prompt, gemma, pubchem
from .forms import preferred_sugar, sugar_forms
from .sources import nci

load_dotenv()


@asynccontextmanager
async def lifespan(app):
    yield
    tasks = [job['task'] for job in summary_jobs.values()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await pubchem.client.aclose()
    await gemma.client.aclose()
    await nci.client.aclose()


app = FastAPI(title="Compound Atlas", lifespan=lifespan)
structure_cache = OrderedDict()
summary_cache = OrderedDict()
summary_jobs = {}
SUMMARY_REQUEST = "Write a clear summary in 120 words or fewer: what this compound is, its structure, and common uses where known. Distinguish general knowledge from sourced properties."


@app.get("/api/health")
def health():
    import os
    return {"status": "ok", "gemma_configured": bool(os.getenv("GEMINI_API_KEY"))}


@app.post("/api/identify")
async def identify(body: IdentificationRequest):
    result = await gemma.identify(body.description)
    return await resolve_identification(body.description, result)


@app.post("/api/identify/resolve")
async def resolve_personal_model(body: ResolveRequest):
    return await resolve_identification(body.description, body.identification)


async def resolve_identification(description, result):
    if result.clarification:
        return {'clarification': result.clarification, 'candidates': [], 'warnings': []}
    seen = set()
    candidates = []
    warnings = []

    async def verify(rank, suggestion):
        item = suggestion.model_dump() | {"rank": rank, "cid": None, "formula": None, "verified": False}
        warning = None
        cids = []
        preferred = preferred_sugar(description, suggestion.name)
        fallback_name = suggestion.name
        if preferred:
            fallback_name = "aldehydo-D-glucose" if preferred['cid'] == 107526 else "keto-D-fructose"
        try:
            cids = [preferred['cid']] if preferred else await pubchem.resolve(suggestion.name)
            # Multiple records require explicit choice; do not silently select a stereoisomer.
            if len(cids) == 1:
                cid = cids[0]
                props = await pubchem.properties(cid)
                item.update(cid=cid, name=preferred['label'] if preferred else props.get("Title", suggestion.name), formula=props.get("MolecularFormula"), verified=True, source_label="PubChem")
            elif cids:
                item["verification_note"] = "Multiple PubChem records match this name. Refine the compound identity."
            else:
                item["verification_note"] = "No matching PubChem record found."
        except HTTPException as exc:
            item["verification_note"] = exc.detail
            warning = exc.detail
        if not item['verified'] and len(cids) <= 1:
            alternate = await nci.resolve(fallback_name)
            if alternate:
                from rdkit import Chem
                graph = Chem.MolFromSmiles(alternate['properties']['SMILES'])
                if not preferred or graph.GetRingInfo().NumRings() == 0:
                    item.update(cid=alternate['cid'], name=alternate['name'], formula=alternate['formula'], verified=True, source_label="NCI/CADD", verification_note="Structure resolved by NCI/CADD; properties calculated by RDKit.")
        return item, warning

    # Resolve independently, then retain the original ranking when merging results.
    resolved = await asyncio.gather(*(verify(rank, suggestion) for rank, suggestion in enumerate(result.candidates, 1)))
    for item, warning in resolved:
        if item["cid"] is not None:
            if item["cid"] in seen:
                continue
            seen.add(item["cid"])
        if warning:
            warnings.append(warning)
        candidates.append(item)
    return {"clarification": result.clarification, "candidates": candidates, "warnings": list(dict.fromkeys(warnings))}


@app.get("/api/compounds/{cid}")
async def details(cid: int):
    if cid < 0:
        return {key: value for key, value in nci.record(cid).items() if key != 'sdf2d'}
    if cid == 0:
        raise HTTPException(422, "A positive PubChem CID is required.")
    props = await pubchem.properties(cid)
    source = f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"
    forms = sugar_forms(cid)
    selected_form = next((form for form in forms if form['cid'] == cid), None)
    return {"cid": cid, "name": props.get("Title", "Unnamed compound"), "iupac": props.get("IUPACName"), "formula": props.get("MolecularFormula"), "properties": props, "source": source, "source_label": "PubChem", "sources": [{"label": "PubChem", "url": source}], "forms": forms, "form_label": selected_form['label'] if selected_form else None}


async def molecule(cid):
    if cid == 0:
        raise HTTPException(422, "A positive PubChem CID is required.")
    cached = structure_cache.get(cid)
    if cached and time.monotonic() - cached[0] < 3600:
        structure_cache.move_to_end(cid)
        return cached[1]
    if cid < 0:
        record = nci.record(cid)
        mol, model = await run_in_threadpool(load_molecule, record['sdf2d'], None)
        return mol, model, [record['record_note']]
    warnings = []
    try:
        sdf2d = await pubchem.get(f"pug/compound/cid/{cid}/record/SDF?record_type=2d", text=True)
    except HTTPException as exc:
        sdf2d = None
        warnings.append(exc.detail)
    if not sdf2d:
        # Resolve by the exact isomeric structure, never by a broad synonym.
        props = await pubchem.properties(cid)
        identifier = props.get('SMILES') or props.get('IsomericSMILES') or props.get('InChIKey')
        fallback = await nci.resolve(identifier) if identifier else None
        if fallback:
            from rdkit import Chem
            expected = Chem.MolFromSmiles(identifier) if props.get('SMILES') or props.get('IsomericSMILES') else None
            matches = Chem.MolToSmiles(expected, True) == fallback['properties']['SMILES'] if expected else props.get('InChIKey') == fallback['properties']['InChIKey']
            if matches:
                sdf2d = fallback['sdf2d']
                warnings.append('2D structure resolved through NCI/CADD using the exact source identity.')
    try:
        sdf3d = await pubchem.get(f"pug/compound/cid/{cid}/record/SDF?record_type=3d", text=True)
    except HTTPException as exc:
        sdf3d = None
        warnings.append(exc.detail)
    try:
        mol, model = await run_in_threadpool(load_molecule, sdf2d, sdf3d)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    value = (mol, model, warnings)
    structure_cache[cid] = (time.monotonic(), value)
    while len(structure_cache) > 64:
        structure_cache.popitem(last=False)
    return value


@app.get("/api/compounds/{cid}/structures")
async def structures(cid: int):
    from rdkit import Chem
    mol, model, warnings = await molecule(cid)
    options, bonds = await run_in_threadpool(availability, mol, model)
    atoms = model.GetAtoms() if model is not None else Chem.AddHs(mol).GetAtoms()
    elements = sorted(set(a.GetSymbol() for a in atoms))
    return {"sdf": Chem.MolToMolBlock(model) if model else None, "projections": options, "bonds": bonds, "elements": elements, "disconnected": len(Chem.GetMolFrags(mol)) > 1, "warnings": warnings, "unavailable_reason": None if model else "No matching PubChem 3D conformer is available. Explore the 2D views instead."}


@app.post("/api/compounds/{cid}/projections")
async def projection(cid: int, body: ProjectionRequest):
    mol, model, _ = await molecule(cid)
    try:
        return await run_in_threadpool(project, mol, model, body.kind, body.bond, body.reverse)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/compounds/{cid}/summary")
async def summary(cid: int, refresh: bool = Query(False)):
    key = cid
    cached = summary_cache.get(key)
    if not refresh and cached and time.monotonic() - cached[0] < 3600:
        return {"text": cached[1]}
    record = await details(cid)
    text = await gemma.generate(evidence_prompt(record), [{"role": "user", "text": "Write a concise, welcoming summary in 120 words or fewer: what this compound is, its structure, and common uses where known. Clearly distinguish general knowledge from the sourced properties. No headings."}])
    summary_cache[key] = (time.monotonic(), text)
    while len(summary_cache) > 128:
        summary_cache.popitem(last=False)
    return {"text": text}


@app.get("/api/compounds/{cid}/summary/stream")
async def summary_stream(cid: int):
    cached = summary_cache.get(cid)
    if cached and time.monotonic() - cached[0] < 3600:
        async def existing():
            yield json.dumps({'text': cached[1]}) + '\n'
            yield '{"done":true}\n'
        return StreamingResponse(existing(), media_type='application/x-ndjson')
    gemma.configuration()
    record = await details(cid)
    if cid not in summary_jobs:
        job = {'chunks': [], 'done': False, 'error': None, 'condition': asyncio.Condition()}
        summary_jobs[cid] = job

        async def produce():
            try:
                async for chunk in gemma.stream(evidence_prompt(record), [{'role': 'user', 'text': SUMMARY_REQUEST}]):
                    async with job['condition']:
                        job['chunks'].append(chunk)
                        job['condition'].notify_all()
                if not job['chunks']:
                    raise HTTPException(502, 'Gemma returned no summary. Please try again.')
                summary_cache[cid] = (time.monotonic(), ''.join(job['chunks']))
                while len(summary_cache) > 128:
                    summary_cache.popitem(last=False)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                job['error'] = exc.detail if isinstance(exc, HTTPException) else 'Summary generation was interrupted. Please try again.'
            finally:
                async with job['condition']:
                    job['done'] = True
                    job['condition'].notify_all()
                summary_jobs.pop(cid, None)

        job['task'] = asyncio.create_task(produce())
    job = summary_jobs[cid]

    async def events():
        index = 0
        while True:
            async with job['condition']:
                await job['condition'].wait_for(lambda: len(job['chunks']) > index or job['done'])
                chunks = job['chunks'][index:]
                index += len(chunks)
                done, error = job['done'], job['error']
            for chunk in chunks:
                yield json.dumps({'text': chunk}) + '\n'
            if done:
                if error:
                    yield json.dumps({'error': error}) + '\n'
                yield '{"done":true}\n'
                break

    return StreamingResponse(events(), media_type='application/x-ndjson', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@app.post("/api/compounds/{cid}/chat")
async def chat(cid: int, body: ChatRequest):
    gemma.configuration()
    record = await details(cid)
    if body.messages[-1].role != "user" or any(m.role != ("user" if i % 2 == 0 else "model") for i, m in enumerate(body.messages)):
        raise HTTPException(422, "Conversation messages must alternate user and model, ending with a user question.")

    async def events():
        received = False
        try:
            async for chunk in gemma.stream(evidence_prompt(record), [m.model_dump() for m in body.messages]):
                received = True
                yield json.dumps({"text": chunk}) + "\n"
            if not received:
                yield json.dumps({"error": "Gemma returned no answer. Try rephrasing your question."}) + "\n"
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Never return upstream exception bodies or credential-bearing request URLs.
            detail = exc.detail if isinstance(exc, HTTPException) else "The connection was interrupted. Please try again."
            yield json.dumps({"error": detail}) + "\n"
        yield json.dumps({"done": True}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# Optional single-origin serving after `npm run build`; development uses Vite's proxy.
dist = Path(__file__).resolve().parent.parent / "dist"
if dist.is_dir():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/favicon.svg")
    def favicon():
        return FileResponse(dist / "favicon.svg")

    @app.get("/")
    def index():
        return FileResponse(dist / "index.html")
