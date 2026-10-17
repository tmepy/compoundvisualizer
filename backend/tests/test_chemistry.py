import re
import xml.etree.ElementTree as ET

import pytest
from rdkit import Chem
from rdkit.Chem import AllChem

from backend.chemistry import (
    availability, bond_projection, depiction, eligible_bonds, fischer_backbone,
    fischer_projection, load_molecule, local_fischer_tag, project,
)


def molecule(smiles):
    mol = Chem.MolFromSmiles(smiles)
    assert mol is not None
    return mol


def conformer(smiles):
    mol = Chem.AddHs(molecule(smiles))
    assert AllChem.EmbedMolecule(mol, randomSeed=42) == 0
    return mol


@pytest.mark.parametrize('smiles', ['CC(=O)Oc1ccccc1C(=O)O', 'O', '[Na+].[Cl-]'])
def test_source_depictions_are_valid_svg(smiles):
    assert ET.fromstring(depiction(molecule(smiles))).tag.endswith('svg')


def test_no_coordinates_means_no_invented_3d():
    mol = molecule('CCCC')
    options, bonds = availability(mol, None)
    assert not bonds
    assert not options['newman']['enabled']
    assert not options['sawhorse']['enabled']
    assert options['skeletal']['enabled']


@pytest.mark.parametrize('smiles', ['c1ccccc1', 'C1CCCCC1', 'C=C'])
def test_rings_aromatic_and_double_bonds_are_not_projection_axes(smiles):
    assert eligible_bonds(conformer(smiles)) == []


def test_newman_and_sawhorse_share_selected_atoms_and_reverse_direction():
    model = conformer('CCCC')
    bond = eligible_bonds(model)[1]
    newman = bond_projection(model, bond['id'], 'newman')
    sawhorse = bond_projection(model, bond['id'], 'sawhorse')
    reverse = bond_projection(model, bond['id'], 'newman', True)
    assert newman['highlight'] == sawhorse['highlight'] == bond['atoms']
    assert reverse['highlight'] == bond['atoms'][::-1]
    assert newman['svg'] != reverse['svg']
    assert ET.fromstring(sawhorse['svg']).tag.endswith('svg')
    with pytest.raises(ValueError, match='eligible'):
        bond_projection(model, 999, 'newman')


@pytest.mark.parametrize(('smiles', 'reason'), [
    ('O=CC(O)CO', 'unspecified'),
    ('C1C(O)CCC1', 'acyclic'),
    ('CC(C)CO', 'unbranched'),
    ('CCCC', 'No tetrahedral'),
    ('[Na+].[Cl-]', 'connected'),
])
def test_fischer_disabled_reasons(smiles, reason):
    chain, message = fischer_backbone(molecule(smiles))
    assert chain is None
    assert reason in message


def test_fischer_enantiomers_have_opposite_side_groups():
    # Glyceraldehyde has an aldehyde at the top and CH2OH at the bottom.
    outputs = []
    for smiles in ('O=C[C@H](O)CO', 'O=C[C@@H](O)CO'):
        mol = molecule(smiles)
        chain, reason = fischer_backbone(mol)
        assert chain and reason is None
        result = fischer_projection(mol)
        assert ET.fromstring(result['svg']).tag.endswith('svg')
        sides = re.findall(r'<text x="(285\.00|555\.00)"[^>]*>(.*?)</text>', result['svg'])
        assert sorted(label for _, label in sides) == ['H', 'OH']
        outputs.append(sides)
    assert outputs[0] == [(x, outputs[1][1-i][1]) for i, (x, _) in enumerate(outputs[0])]


def test_fischer_cross_geometry_has_expected_absolute_configuration():
    # In standard D-glyceraldehyde (R), OH lies on the right of the Fischer cross.
    mol = Chem.AddHs(molecule('O=C[C@H](O)CO'))
    chain, reason = fischer_backbone(mol)
    assert reason is None
    center = chain[1]
    neighbors = list(mol.GetAtomWithIdx(center).GetNeighbors())
    oxygen = next(a.GetIdx() for a in neighbors if a.GetAtomicNum() == 8)
    hydrogen = next(a.GetIdx() for a in neighbors if a.GetAtomicNum() == 1)
    tag = local_fischer_tag(mol, center, chain[0], chain[2], hydrogen, oxygen)
    copy = Chem.Mol(mol)
    copy.GetAtomWithIdx(center).SetChiralTag(tag)
    Chem.AssignStereochemistry(copy, cleanIt=True, force=True)
    assert copy.GetAtomWithIdx(center).GetProp('_CIPCode') == 'R'


def test_specified_open_chain_glucose_is_supported_without_3d():
    mol = molecule('O=C[C@H](O)[C@@H](O)[C@H](O)[C@H](O)CO')
    options, _ = availability(mol, None)
    assert options['fischer']['enabled']
    result = project(mol, None, 'fischer')
    assert 'Configuration diagram' in result['svg']


def test_unspecified_stereochemistry_is_never_assigned_for_a_view():
    mol = molecule('O=CC(O)CO')
    options, _ = availability(mol, None)
    assert not options['wedge']['enabled']
    assert not options['fischer']['enabled']
    with pytest.raises(ValueError, match='unspecified'):
        project(mol, None, 'fischer')


def test_source_atom_order_is_retained_when_3d_is_reordered():
    source = conformer('CCO')
    heavy = Chem.RemoveHs(source)
    AllChem.Compute2DCoords(heavy)
    reordered = Chem.RenumberAtoms(source, list(reversed(range(source.GetNumAtoms()))))
    mol, model = load_molecule(Chem.MolToMolBlock(heavy), Chem.MolToMolBlock(reordered))
    assert model is not None
    assert [a.GetSymbol() for a in mol.GetAtoms()] == [model.GetAtomWithIdx(i).GetSymbol() for i in range(mol.GetNumAtoms())]


def test_different_stereoisomer_coordinates_are_rejected():
    a = conformer('C[C@H](O)C(=O)O')
    b = conformer('C[C@@H](O)C(=O)O')
    two_d = Chem.RemoveHs(a)
    AllChem.Compute2DCoords(two_d)
    _, model = load_molecule(Chem.MolToMolBlock(two_d), Chem.MolToMolBlock(b))
    assert model is None


def test_invalid_structure_is_explained():
    with pytest.raises(ValueError, match='readable'):
        load_molecule('not an SDF')
