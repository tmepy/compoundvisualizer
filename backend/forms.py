"""Explicit records for common sugar forms; do not equate ring and chain graphs."""
import re

SUGAR_FORMS = {
    "glucose": [
        {"cid": 107526, "label": "D-Glucose · open chain", "form": "open-chain"},
        {"cid": 79025, "label": "α-D-Glucopyranose · ring", "form": "cyclic"},
        {"cid": 64689, "label": "β-D-Glucopyranose · ring", "form": "cyclic"},
    ],
    "fructose": [
        {"cid": 5984, "label": "D-Fructose · open chain", "form": "open-chain"},
        {"cid": 439709, "label": "β-D-Fructofuranose · ring", "form": "cyclic"},
        {"cid": 24310, "label": "β-D-Fructopyranose · ring", "form": "cyclic"},
    ],
}


def sugar_forms(cid):
    for family, forms in SUGAR_FORMS.items():
        if cid in [f["cid"] for f in forms] or (family == "glucose" and cid == 5793):
            return forms
    return []


def preferred_sugar(description, name):
    """Only normalize plain sugar identities, never derivatives or L isomers."""
    normalized = re.sub(r"[^a-z]", "", name.lower())
    if normalized not in {"glucose", "dglucose", "dextrose", "fructose", "dfructose", "levulose", "alphadglucose", "betadglucose", "betadfructose", "dglucopyranose", "alphadglucopyranose", "betadglucopyranose", "dfructofuranose", "betadfructofuranose", "dfructopyranose", "betadfructopyranose"}:
        return None
    family = "fructose" if "fruct" in normalized or normalized == 'levulose' else "glucose"
    user = description.lower()
    if re.search(r"\bl[- ](?:glucose|fructose)\b", user):
        return None
    if any(token in user for token in ("pyranose", "furanose", "cyclic", "closed", "ring", "alpha", "beta", "α", "β")):
        return None
    return SUGAR_FORMS[family][0]
