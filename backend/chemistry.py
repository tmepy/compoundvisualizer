"""Deterministic depictions; AI output never defines coordinates or stereochemistry."""
import html
import math

from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Geometry import Point3D


KINDS = ("skeletal", "wedge", "newman", "sawhorse", "fischer")


def load_molecule(sdf2d, sdf3d=None):
    mol = Chem.MolFromMolBlock(sdf2d, removeHs=True) if sdf2d else None
    if mol is None or mol.GetNumAtoms() == 0:
        raise ValueError("No readable molecular structure is available.")
    if mol.GetNumAtoms() > 300:
        raise ValueError("This structure exceeds the viewer's 300-atom limit.")
    Chem.AssignStereochemistry(mol, cleanIt=True, force=True)
    model = None
    if sdf3d:
        candidate = Chem.MolFromMolBlock(sdf3d, removeHs=True)
        if candidate and candidate.GetNumAtoms() == mol.GetNumAtoms():
            # Refuse coordinates for another stereoisomer. Matching order becomes the shared atom ID.
            if Chem.MolToSmiles(candidate, True) == Chem.MolToSmiles(mol, True):
                match = candidate.GetSubstructMatch(mol, useChirality=True)
                if match and candidate.GetConformer().Is3D():
                    model = Chem.AddHs(Chem.RenumberAtoms(candidate, list(match)), addCoords=True)
    return mol, model


def depiction(mol, wedge=True):
    copy = Chem.Mol(mol)
    if not wedge:
        Chem.RemoveStereochemistry(copy)
    rdDepictor.Compute2DCoords(copy)
    drawer = rdMolDraw2D.MolDraw2DSVG(840, 560)
    opts = drawer.drawOptions()
    opts.clearBackground = False
    opts.addAtomIndices = False
    opts.useBWAtomPalette()
    rdMolDraw2D.PrepareAndDrawMolecule(drawer, copy)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def eligible_bonds(model):
    if model is None:
        return []
    result = []
    for bond in model.GetBonds():
        ends = (bond.GetBeginAtom(), bond.GetEndAtom())
        if bond.GetBondType() == Chem.BondType.SINGLE and not bond.IsInRing() and all(a.GetAtomicNum() == 6 and a.GetHybridization() == Chem.HybridizationType.SP3 and a.GetDegree() == 4 for a in ends):
            result.append({"id": bond.GetIdx(), "atoms": [a.GetIdx() for a in ends], "label": f"C{ends[0].GetIdx() + 1} — C{ends[1].GetIdx() + 1}"})
    return result


def fischer_backbone(mol):
    if len(Chem.GetMolFrags(mol)) != 1 or mol.GetRingInfo().NumRings():
        return None, "Fischer view supports connected, acyclic structures in this version."
    carbon = [a.GetIdx() for a in mol.GetAtoms() if a.GetAtomicNum() == 6]
    if len(carbon) < 2:
        return None, "A linear carbon backbone with a stereocenter is required."
    adjacency = {i: [a.GetIdx() for a in mol.GetAtomWithIdx(i).GetNeighbors() if a.GetAtomicNum() == 6] for i in carbon}
    ends = [i for i in carbon if len(adjacency[i]) == 1]
    if len(ends) != 2 or any(len(v) > 2 for v in adjacency.values()):
        return None, "A single unbranched carbon backbone is required in this version."
    # Prefer an aldehyde/carboxyl end, then a ketone-adjacent end. Never imply IUPAC numbering.
    def end_score(idx):
        carbonyls = [i for i in carbon if any(b.GetBondType() == Chem.BondType.DOUBLE and b.GetOtherAtomIdx(i) not in carbon and b.GetOtherAtom(mol.GetAtomWithIdx(i)).GetAtomicNum() == 8 for b in mol.GetAtomWithIdx(i).GetBonds())]
        distance = min((len(Chem.GetShortestPath(mol, idx, other)) - 1 if other != idx else 0 for other in carbonyls), default=len(carbon))
        return (distance, idx)
    start = min(ends, key=end_score)
    chain = [start]
    while True:
        nxt = [i for i in adjacency[chain[-1]] if i not in chain]
        if not nxt:
            break
        chain.append(nxt[0])
    if len(chain) != len(carbon):
        return None, "Disconnected carbon backbones are unsupported."
    centers = Chem.FindMolChiralCenters(mol, includeUnassigned=True, useLegacyImplementation=False)
    if not centers:
        return None, "No tetrahedral stereocenters are present."
    if any(label == "?" for _, label in centers):
        return None, "Stereochemistry is unspecified. Select a fully specified stereoisomer."
    interior = chain[1:-1]
    if any(idx not in interior for idx, _ in centers):
        return None, "This stereocenter cannot be placed on the supported Fischer backbone."
    if any(mol.GetAtomWithIdx(idx).GetChiralTag() not in (Chem.ChiralType.CHI_TETRAHEDRAL_CW, Chem.ChiralType.CHI_TETRAHEDRAL_CCW) for idx, _ in centers):
        return None, "Only specified tetrahedral stereocenters are supported in Fischer view."
    explicit = Chem.AddHs(mol)
    for idx in interior:
        atom = explicit.GetAtomWithIdx(idx)
        if atom.GetHybridization() != Chem.HybridizationType.SP3 or atom.GetDegree() != 4:
            side = [n for n in atom.GetNeighbors() if n.GetIdx() not in chain]
            carbonyl = atom.GetHybridization() == Chem.HybridizationType.SP2 and len(side) == 1 and side[0].GetAtomicNum() == 8 and side[0].GetDegree() == 1 and explicit.GetBondBetweenAtoms(idx, side[0].GetIdx()).GetBondType() == Chem.BondType.DOUBLE
            if carbonyl:
                continue
            return None, "Internal backbone atoms must be tetrahedral carbons or simple carbonyl groups."
        # Bound the v1 subset to terminal side atoms, avoiding ambiguous abbreviated groups.
        for neighbor in atom.GetNeighbors():
            if neighbor.GetIdx() not in chain and neighbor.GetAtomicNum() != 1:
                heavy_degree = sum(a.GetAtomicNum() > 1 for a in neighbor.GetNeighbors())
                if heavy_degree != 1:
                    return None, "Complex side groups are unsupported in Fischer view."
    return chain, None


def availability(mol, model):
    bonds = eligible_bonds(model)
    chain, reason = fischer_backbone(mol)
    has_stereo = any(a.GetChiralTag() != Chem.ChiralType.CHI_UNSPECIFIED for a in mol.GetAtoms()) or any(b.GetStereo() not in (Chem.BondStereo.STEREONONE, Chem.BondStereo.STEREOANY) for b in mol.GetBonds())
    result = {kind: {"enabled": True, "reason": None} for kind in KINDS}
    result["wedge"] = {"enabled": has_stereo, "reason": None if has_stereo else "No specified stereochemistry; use the skeletal view."}
    for kind in ("newman", "sawhorse"):
        result[kind] = {"enabled": bool(bonds), "reason": None if bonds else "Requires a 3D conformer and a non-ring single bond between tetrahedral carbons."}
    result["fischer"] = {"enabled": bool(chain), "reason": reason}
    return result, bonds


def svg_document(contents, height=560):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 {height}" role="img"><g fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round">{contents}</g></svg>'


def line(x1, y1, x2, y2):
    return f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}"/>'


def text(x, y, label, size=20):
    return f'<text x="{x:.2f}" y="{y:.2f}" text-anchor="middle" dominant-baseline="middle" stroke="none" font-family="system-ui,sans-serif" font-size="{size}">{html.escape(label)}</text>'


def group_label(mol, idx, excluded):
    atom = mol.GetAtomWithIdx(idx)
    symbol = f"[{atom.GetIsotope()}{atom.GetSymbol()}]" if atom.GetIsotope() else atom.GetSymbol()
    charge = atom.GetFormalCharge()
    charge_label = ((str(abs(charge)) if abs(charge) > 1 else "") + ("+" if charge > 0 else "-")).translate(str.maketrans("0123456789+-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻")) if charge else ""
    if atom.GetAtomicNum() == 1:
        return symbol + charge_label
    if atom.GetAtomicNum() == 6:
        h_count = sum(n.GetAtomicNum() == 1 for n in atom.GetNeighbors())
        remaining = [n for n in atom.GetNeighbors() if n.GetIdx() not in excluded and n.GetAtomicNum() != 1]
        if not remaining:
            return symbol + (f"H{h_count}" if h_count > 1 else "H" if h_count else "") + charge_label
    if atom.GetAtomicNum() in (7, 8, 16):
        heavy = [n for n in atom.GetNeighbors() if n.GetAtomicNum() != 1 and n.GetIdx() not in excluded]
        h_count = sum(n.GetAtomicNum() == 1 for n in atom.GetNeighbors())
        if not heavy:
            return symbol + (f"H{h_count}" if h_count > 1 else "H" if h_count else "") + charge_label
    if atom.GetDegree() == 1:
        return symbol + charge_label
    return f"{symbol}{idx + 1}{charge_label}*"


def vector_sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def unit(a):
    norm = math.sqrt(dot(a, a))
    if norm < 1e-8:
        raise ValueError("This conformer has degenerate bond coordinates.")
    return tuple(v / norm for v in a)


def bond_projection(model, bond_id, kind, reverse=False):
    bonds = eligible_bonds(model)
    selected = next((b for b in bonds if b["id"] == bond_id), None)
    if not selected:
        raise ValueError("Select an eligible carbon–carbon bond.")
    front, back = selected["atoms"][::-1] if reverse else selected["atoms"]
    conf = model.GetConformer()
    points = {a.GetIdx(): tuple(conf.GetAtomPosition(a.GetIdx())) for a in model.GetAtoms()}
    axis = unit(vector_sub(points[back], points[front]))
    helper = (0, 0, 1) if abs(axis[2]) < .9 else (0, 1, 0)
    right = unit(cross(axis, helper))
    up = unit(cross(right, axis))
    neighbors = {}
    for center, other in ((front, back), (back, front)):
        neighbors[center] = []
        for atom in model.GetAtomWithIdx(center).GetNeighbors():
            if atom.GetIdx() == other:
                continue
            delta = vector_sub(points[atom.GetIdx()], points[center])
            angle = math.atan2(dot(delta, up), dot(delta, right))
            if kind == "sawhorse":
                # Orthographically project at an oblique angle, then turn the screen
                # plane so the axis slopes upward. Retain the conformer's handedness.
                screen_x = .7 * dot(delta, right) + math.sqrt(.51) * dot(delta, axis)
                screen_y = -dot(delta, up)
                angle = -math.atan2(screen_y, screen_x) + math.atan2(130, 180)
            neighbors[center].append((angle, group_label(model, atom.GetIdx(), {front, back}), atom.GetIdx()))
    output = []
    if kind == "newman":
        output.append('<circle cx="420" cy="270" r="57" fill="none"/>')
        positions = [(back, 420, 270, 57), (front, 420, 270, 0)]
    else:
        output.append(line(330, 340, 510, 210))
        positions = [(back, 510, 210, 0), (front, 330, 340, 0)]
    for center, x, y, radius in positions:
        for angle, label, idx in neighbors[center]:
            dx, dy = math.cos(angle), -math.sin(angle)
            output.append(line(x + radius*dx, y + radius*dy, x + 126*dx, y + 126*dy))
            output.append(text(x + 157*dx, y + 157*dy, label))
        if kind == "sawhorse":
            output.append(text(x, y + 25, f"C{center + 1}", 15))
    if kind == "newman":
        output.append('<circle cx="420" cy="270" r="6"/>')
    output.append(text(420, 500, f"Looking from C{front + 1} toward C{back + 1} · PubChem conformer", 17))
    output.append(text(420, 530, "* Atom IDs identify groups continuing beyond the displayed bond.", 14))
    return {"svg": svg_document("".join(output)), "highlight": [front, back], "caption": "Projection of the retrieved conformer; angles are not an energy calculation."}


def local_fischer_tag(mol, idx, top, bottom, left, right):
    """Read a Fischer cross as local tetrahedral geometry using RDKit's own stereo assignment."""
    copy = Chem.Mol(mol)
    copy.RemoveAllConformers()
    conf = Chem.Conformer(copy.GetNumAtoms())
    conf.Set3D(True)
    for atom_idx, position in ((idx, (0, 0, 0)), (top, (0, 1, -1)), (bottom, (0, -1, -1)), (left, (-1, 0, 1)), (right, (1, 0, 1))):
        conf.SetAtomPosition(atom_idx, Point3D(*position))
    copy.AddConformer(conf)
    Chem.AssignAtomChiralTagsFromStructure(copy, replaceExistingTags=True)
    return copy.GetAtomWithIdx(idx).GetChiralTag()


def fischer_projection(mol):
    chain, reason = fischer_backbone(mol)
    if not chain:
        raise ValueError(reason)
    explicit = Chem.AddHs(mol)
    rows = []
    for pos, idx in enumerate(chain[1:-1], 1):
        top, bottom = chain[pos-1], chain[pos+1]
        sides = [n.GetIdx() for n in explicit.GetAtomWithIdx(idx).GetNeighbors() if n.GetIdx() not in (top, bottom)]
        if len(sides) == 1:
            rows.append((idx, None, sides[0]))
            continue
        left, right = sides
        desired = explicit.GetAtomWithIdx(idx).GetChiralTag()
        if desired != Chem.ChiralType.CHI_UNSPECIFIED:
            if local_fischer_tag(explicit, idx, top, bottom, left, right) != desired:
                left, right = right, left
            if local_fischer_tag(explicit, idx, top, bottom, left, right) != desired:
                raise ValueError("The Fischer stereochemistry could not be verified.")
        rows.append((idx, left, right))
    height = max(560, 220 + len(rows)*100)
    def terminal_label(idx, neighbor):
        # A fragment SMILES makes terminal carbonyl/carboxyl identity explicit.
        indices = [idx] + [n.GetIdx() for n in mol.GetAtomWithIdx(idx).GetNeighbors() if n.GetIdx() != neighbor]
        return Chem.MolFragmentToSmiles(mol, indices, rootedAtAtom=idx)
    output = [text(420, 65, terminal_label(chain[0], chain[1]), 23)]
    end_y = 130 + len(rows)*100
    output.append(line(420, 90, 420, end_y-25))
    for row, (idx, left, right) in enumerate(rows):
        y = 150 + row*100
        if left is None:
            output.extend([line(420, y - 4, 510, y - 4), line(420, y + 4, 510, y + 4), text(555, y, 'O')])
        else:
            output.extend([line(330, y, 510, y), text(285, y, group_label(explicit, left, set(chain))), text(555, y, group_label(explicit, right, set(chain)))])
    output.extend([text(420, end_y, terminal_label(chain[-1], chain[-2]), 23), text(420, height-60, "Horizontal bonds point toward you; vertical bonds point away.", 16), text(420, height-30, "Configuration diagram · not a molecular conformation", 15)])
    return {"svg": svg_document("".join(output), height), "highlight": chain, "caption": "Fischer projection with configuration checked against the source stereochemistry."}


def project(mol, model, kind, bond=None, reverse=False):
    options, bonds = availability(mol, model)
    if not options[kind]["enabled"]:
        raise ValueError(options[kind]["reason"])
    if kind in ("skeletal", "wedge"):
        return {"svg": depiction(mol, wedge=kind == "wedge"), "highlight": [], "caption": "Recorded stereochemistry is shown only in wedge-and-dash view." if kind == "skeletal" else "Solid wedges point toward you; dashed wedges point away. Unspecified centers are not assigned."}
    if kind == "fischer":
        return fischer_projection(mol)
    return bond_projection(model, bond if bond is not None else bonds[0]["id"], kind, reverse)
