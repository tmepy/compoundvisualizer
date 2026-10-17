import httpx
import pytest
from rdkit import Chem

from backend.forms import preferred_sugar, sugar_forms
from backend.chemistry import availability, fischer_projection
from backend.sources import NCIFallback


@pytest.mark.parametrize(('name', 'cid'), [('D-glucose', 107526), ('glucose', 107526), ('D fructose', 5984), ('fructose', 5984)])
def test_plain_sugars_choose_open_chain(name, cid):
    assert preferred_sugar(name, name)['cid'] == cid


@pytest.mark.parametrize('description', ['beta-D-glucose', 'alpha-D-fructofuranose', 'cyclic D-glucose', 'L-glucose', 'glucose in pyranose form'])
def test_explicit_forms_are_not_replaced(description):
    assert preferred_sugar(description, 'D-glucose') is None


def test_derivatives_are_not_replaced_with_parent_sugars():
    assert preferred_sugar('glucose', 'glucose-6-phosphate') is None
    assert [f['cid'] for f in sugar_forms(5793)] == [107526, 79025, 64689]


def test_open_chain_fructose_fischer_keeps_the_ketone():
    mol = Chem.MolFromSmiles('OC[C@@H](O)[C@@H](O)[C@H](O)C(=O)CO')
    assert availability(mol, None)[0]['fischer']['enabled']
    projection = fischer_projection(mol)
    assert 'O</text>' in projection['svg']
    assert projection['svg'].count('<line') >= 6
    assert len(mol.GetSubstructMatches(Chem.MolFromSmarts('[#6]=[#8]'))) == 1


@pytest.mark.asyncio
async def test_nci_fallback_attribution_and_stable_identity():
    service = NCIFallback()
    await service.client.aclose()
    service.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text='CCO')))
    try:
        a = await service.resolve('ethanol')
        b = await service.resolve('ethyl alcohol')
        assert a['cid'] == b['cid'] < 0
        assert a['source_label'] == 'NCI/CADD'
        assert 'MolecularWeight' in a['computed_fields']
        assert 'LogP' in a['properties'] and 'XLogP' not in a['properties']
        assert a['iupac'] is None
        assert Chem.MolFromMolBlock(a['sdf2d']) is not None
    finally:
        await service.client.aclose()


@pytest.mark.asyncio
async def test_nci_rejects_lost_stereochemistry():
    service = NCIFallback()
    await service.client.aclose()
    service.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text='O=CC(O)CO')))
    try:
        assert await service.resolve('D-glyceraldehyde') is None
    finally:
        await service.client.aclose()
