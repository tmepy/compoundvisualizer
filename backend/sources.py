"""NCI/CADD fallback records and explicitly attributed computed properties."""
import asyncio
import hashlib
import re
from collections import OrderedDict
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, rdDepictor, rdMolDescriptors

FALLBACK_LIMIT = 128


def computed_properties(mol):
    return {
        "MolecularFormula": rdMolDescriptors.CalcMolFormula(mol),
        "MolecularWeight": round(Descriptors.MolWt(mol), 3),
        "LogP": round(Crippen.MolLogP(mol), 3),
        "TPSA": round(rdMolDescriptors.CalcTPSA(mol), 3),
        "HBondDonorCount": rdMolDescriptors.CalcNumHBD(mol),
        "HBondAcceptorCount": rdMolDescriptors.CalcNumHBA(mol),
        "Charge": Chem.GetFormalCharge(mol),
        "SMILES": Chem.MolToSmiles(mol, isomericSmiles=True),
        "InChIKey": Chem.MolToInchiKey(mol),
    }


class NCIFallback:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=12, follow_redirects=True)
        self.records = OrderedDict()
        self.semaphore = asyncio.Semaphore(2)

    async def resolve(self, name):
        source = f"https://cactus.nci.nih.gov/chemical/structure/{quote(name, safe='')}/smiles"
        try:
            async with self.semaphore:
                response = await self.client.get(source)
            if response.is_error:
                return None
            smiles = response.text.strip()
            if '\n' in smiles or len(smiles) > 5000:
                return None
            mol = Chem.MolFromSmiles(smiles)
            if mol is None or not 0 < mol.GetNumAtoms() <= 300:
                return None
            centers = Chem.FindMolChiralCenters(mol, includeUnassigned=True, useLegacyImplementation=False)
            # NCI documents that some name resolutions omit stereo. Never verify
            # a stereospecific query against such an incomplete structure.
            if re.search(r"(?:\b[dlrs][- (]|alpha|beta|α|β|pyranose|furanose)", name, re.I) and any(label == '?' for _, label in centers):
                return None
            props = computed_properties(mol)
            cid = -int(hashlib.sha256(props['SMILES'].encode()).hexdigest()[:12], 16)
            rdDepictor.Compute2DCoords(mol)
            record = {
                'cid': cid, 'name': name, 'iupac': None, 'formula': props['MolecularFormula'],
                'properties': props, 'source': source, 'source_label': 'NCI/CADD',
                'sources': [{'label': 'NCI/CADD Chemical Identifier Resolver', 'url': source}, {'label': 'RDKit computed properties', 'url': 'https://www.rdkit.org/docs/'}],
                'computed_fields': list(props), 'sdf2d': Chem.MolToMolBlock(mol),
                'record_note': 'Structure resolved through NCI/CADD. Displayed properties are calculated by RDKit; no measured values or 3D conformer are implied.',
            }
            self.records[cid] = record
            self.records.move_to_end(cid)
            while len(self.records) > FALLBACK_LIMIT:
                self.records.popitem(last=False)
            return record
        except (httpx.RequestError, ValueError, RuntimeError):
            return None

    def record(self, cid):
        if cid not in self.records:
            raise HTTPException(404, 'This alternate-source record expired. Search for the compound again.')
        self.records.move_to_end(cid)
        return self.records[cid]


nci = NCIFallback()
