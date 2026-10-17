import json

import httpx
import pytest
from fastapi import HTTPException

from backend.main import app, structure_cache, summary_cache
from backend.models import Identification
from backend.services import Gemma, PubChem, gemma, pubchem
from backend.sources import nci


@pytest.fixture(autouse=True)
def no_unmocked_fallback_network(monkeypatch):
    async def absent(_):
        return None
    monkeypatch.setattr(nci, 'resolve', absent)


@pytest.fixture
def anyio_backend():
    return 'asyncio'


@pytest.fixture
def client():
    structure_cache.clear()
    summary_cache.clear()
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')


@pytest.fixture
def properties(monkeypatch):
    async def get_props(cid):
        return {'CID': cid, 'Title': 'Ethanol', 'MolecularFormula': 'C2H6O', 'MolecularWeight': '46.07'}
    monkeypatch.setattr(pubchem, 'properties', get_props)


@pytest.mark.asyncio
async def test_missing_key_is_actionable(client, monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    async with client:
        response = await client.post('/api/identify', json={'description': 'coffee stimulant'})
    assert response.status_code == 503
    assert 'GEMINI_API_KEY' in response.json()['detail']


@pytest.mark.asyncio
async def test_ranking_deduplication_and_unverified_candidates(client, monkeypatch, properties):
    async def identify(_):
        return Identification.model_validate({'candidates': [
            {'name': 'ethanol', 'category': 'organic', 'reason': 'A solvent.'},
            {'name': 'ethyl alcohol', 'category': 'organic', 'reason': 'A synonym.'},
            {'name': 'salt', 'category': 'inorganic', 'reason': 'An ambiguous salt.'},
            {'name': 'unobtainium', 'category': 'inorganic', 'reason': 'An unresolved name.'},
        ]})
    async def resolve(name):
        return {'ethanol': [702], 'ethyl alcohol': [702], 'salt': [1, 2]}.get(name, [])
    monkeypatch.setattr(gemma, 'identify', identify)
    monkeypatch.setattr(pubchem, 'resolve', resolve)
    async with client:
        response = await client.post('/api/identify', json={'description': 'a solvent and salt'})
    assert response.status_code == 200
    results = response.json()['candidates']
    assert [item['rank'] for item in results] == [1, 3, 4]
    assert [item['verified'] for item in results] == [True, False, False]
    assert results[1]['cid'] is None


@pytest.mark.asyncio
async def test_clarification_does_not_invent_candidates(client, monkeypatch):
    async def identify(_):
        return Identification(clarification='What is it used for?')
    monkeypatch.setattr(gemma, 'identify', identify)
    async with client:
        response = await client.post('/api/identify', json={'description': 'a white powder'})
    assert response.json()['candidates'] == []
    assert response.json()['clarification']


@pytest.mark.asyncio
async def test_partial_pubchem_failure_retains_suggestions(client, monkeypatch):
    async def identify(_):
        return Identification.model_validate({'candidates': [{'name': 'ethanol', 'category': 'organic', 'reason': 'A solvent.'}]})
    async def resolve(_):
        raise HTTPException(429, 'PubChem is busy.')
    monkeypatch.setattr(gemma, 'identify', identify)
    monkeypatch.setattr(pubchem, 'resolve', resolve)
    async with client:
        response = await client.post('/api/identify', json={'description': 'a solvent'})
    assert response.status_code == 200
    assert not response.json()['candidates'][0]['verified']
    assert response.json()['warnings'] == ['PubChem is busy.']


@pytest.mark.asyncio
async def test_chat_stream_and_error_events(client, monkeypatch, properties):
    monkeypatch.setattr(gemma, 'configuration', lambda: ('test-key', 'test-model'))
    async def stream(*_):
        yield 'Ethanol '
        yield 'is a compound.'
    monkeypatch.setattr(gemma, 'stream', stream)
    async with client:
        response = await client.post('/api/compounds/702/chat', json={'messages': [{'role': 'user', 'text': 'What is it?'}]})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert ''.join(event.get('text', '') for event in events) == 'Ethanol is a compound.'
    assert events[-1] == {'done': True}


@pytest.mark.asyncio
async def test_chat_errors_do_not_leak_credentials(client, monkeypatch, properties):
    monkeypatch.setattr(gemma, 'configuration', lambda: ('test-key', 'test-model'))
    async def stream(*_):
        yield 'Partial '
        raise RuntimeError('secret-key-from-provider')
    monkeypatch.setattr(gemma, 'stream', stream)
    async with client:
        response = await client.post('/api/compounds/702/chat', json={'messages': [{'role': 'user', 'text': 'Explain'}]})
    assert 'secret-key' not in response.text
    assert any('error' in json.loads(line) for line in response.text.splitlines())


@pytest.mark.asyncio
async def test_summary_uses_evidence_and_missing_properties_stay_missing(client, monkeypatch, properties):
    async def generate(instruction, messages):
        assert 'https://pubchem.ncbi.nlm.nih.gov/compound/702' in instruction
        assert 'MolecularWeight' in instruction
        return 'A simple alcohol.'
    monkeypatch.setattr(gemma, 'generate', generate)
    async with client:
        summary = await client.get('/api/compounds/702/summary')
        detail = await client.get('/api/compounds/702')
    assert summary.json()['text'] == 'A simple alcohol.'
    assert 'XLogP' not in detail.json()['properties']


@pytest.mark.asyncio
async def test_gemma_repairs_json_once(monkeypatch):
    service = Gemma()
    replies = iter(['not json', '{"candidates": [], "clarification": "What is its use?"}'])
    async def generate(*_):
        return next(replies)
    monkeypatch.setattr(service, 'generate', generate)
    result = await service.identify('white powder')
    assert result.clarification == 'What is its use?'


@pytest.mark.asyncio
async def test_gemma_rejects_invalid_json_after_one_repair(monkeypatch):
    service = Gemma()
    calls = []
    async def generate(*_):
        calls.append(1)
        return '{"candidates": [{"name": "x", "category": "unknown", "reason": "x"}]}'
    monkeypatch.setattr(service, 'generate', generate)
    with pytest.raises(HTTPException) as error:
        await service.identify('some compound')
    assert error.value.status_code == 502
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_pubchem_cache_and_not_found():
    calls = []
    def transport(request):
        calls.append(request.url.path)
        return httpx.Response(404) if 'missing' in request.url.path else httpx.Response(200, json={'ok': True})
    service = PubChem()
    await service.client.aclose()
    service.client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    try:
        assert await service.get('pug/test') == {'ok': True}
        assert await service.get('pug/test') == {'ok': True}
        assert len(calls) == 1
        assert await service.get('pug/missing') is None
    finally:
        await service.client.aclose()


@pytest.mark.asyncio
async def test_summary_stream_is_cached_and_uses_public_evidence(client, monkeypatch, properties):
    monkeypatch.setattr(gemma, 'configuration', lambda: ('host-secret', 'gemma-test'))
    calls = []
    async def stream(instruction, messages):
        assert 'https://pubchem.ncbi.nlm.nih.gov/compound/702' in instruction
        calls.append(1)
        yield 'A clear '
        yield 'summary.'
    monkeypatch.setattr(gemma, 'stream', stream)
    async with client:
        first = await client.get('/api/compounds/702/summary/stream')
        second = await client.get('/api/compounds/702/summary/stream')
    events = [json.loads(line) for line in first.text.splitlines()]
    assert events == [{'text': 'A clear '}, {'text': 'summary.'}, {'done': True}]
    assert len(calls) == 1
    assert 'host-secret' not in first.text
    assert ''.join(json.loads(line).get('text', '') for line in second.text.splitlines()) == 'A clear summary.'


@pytest.mark.asyncio
async def test_browser_candidates_resolve_without_host_key(client, monkeypatch, properties):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    async def resolve(_):
        return [702]
    monkeypatch.setattr(pubchem, 'resolve', resolve)
    async with client:
        response = await client.post('/api/identify/resolve', json={'description': 'a solvent', 'identification': {'candidates': [{'name': 'ethanol', 'category': 'organic', 'reason': 'A solvent.'}]}})
    assert response.status_code == 200
    assert response.json()['candidates'][0]['cid'] == 702


@pytest.mark.asyncio
async def test_sugar_resolution_uses_open_chain_record(client, monkeypatch):
    calls = []
    async def props(cid):
        calls.append(cid)
        return {'Title': 'D-glucose', 'MolecularFormula': 'C6H12O6'}
    monkeypatch.setattr(pubchem, 'properties', props)
    async with client:
        response = await client.post('/api/identify/resolve', json={'description': 'D-glucose', 'identification': {'candidates': [{'name': 'D-glucose', 'category': 'organic', 'reason': 'An aldohexose.'}]}})
        record = await client.get('/api/compounds/107526')
    assert calls == [107526, 107526]
    assert response.json()['candidates'][0]['cid'] == 107526
    assert record.json()['forms'][0]['form'] == 'open-chain'


@pytest.mark.asyncio
async def test_nci_success_opens_a_source_labeled_workspace(client, monkeypatch):
    from backend.sources import NCIFallback
    alternate = NCIFallback()
    await alternate.client.aclose()
    alternate.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text='CCO')))
    async def missing(_):
        return []
    monkeypatch.setattr(pubchem, 'resolve', missing)
    async def resolve(name):
        record = await alternate.resolve(name)
        nci.records[record['cid']] = record
        return record
    monkeypatch.setattr(nci, 'resolve', resolve)
    # Keep route assertions independent of background-executor scheduling;
    # the actual chemistry functions still run and have their own fixtures.
    async def inline_worker(function, *args, **kwargs):
        return function(*args, **kwargs)
    monkeypatch.setattr('backend.main.run_in_threadpool', inline_worker)
    try:
        async with client:
            response = await client.post('/api/identify/resolve', json={'description': 'a solvent', 'identification': {'candidates': [{'name': 'ethanol', 'category': 'organic', 'reason': 'A solvent.'}]}})
            candidate = response.json()['candidates'][0]
            record = await client.get(f"/api/compounds/{candidate['cid']}")
            structure = await client.get(f"/api/compounds/{candidate['cid']}/structures")
        assert candidate['verified'] and candidate['cid'] < 0
        assert record.json()['source_label'] == 'NCI/CADD'
        assert 'MolecularWeight' in record.json()['computed_fields']
        assert structure.json()['projections']['skeletal']['enabled']
    finally:
        await alternate.client.aclose()
