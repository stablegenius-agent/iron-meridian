"""Convert Natural Earth GeoJSON into the compact data/world.json the game loads.

Run:  uv run --no-project python tools/prep_geo.py
Output: data/world.json  {countries:[...], cities:[...]}
Coordinates are [lon, lat] rounded to 0.05 deg with consecutive-duplicate removal (plenty for a
4096px equirectangular texture: 1px ~ 0.088 deg).
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "ne_50m_admin_0_countries.geojson"
CITIES = ROOT / "tools" / "ne_110m_populated_places_simple.geojson"
OUT = ROOT / "data" / "world.json"

Q = 0.05  # quantization step in degrees


def q(v):
    return round(round(v / Q) * Q, 2)


def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(a) / 2


def simplify_ring(ring):
    out = []
    for lon, lat in ring:
        p = [q(lon), q(lat)]
        if not out or out[-1] != p:
            out.append(p)
    if len(out) >= 2 and out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def polys_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def main():
    src = json.loads(SRC.read_text(encoding="utf-8"))
    countries = []
    for f in src["features"]:
        p = f["properties"]
        name = p.get("NAME_EN") or p.get("NAME") or p.get("ADMIN")
        iso = p.get("ADM0_A3") or p.get("ISO_A3")
        if p.get("ADMIN") == "Antarctica":
            continue
        polys = []
        total_area = 0.0
        for poly in polys_of(f["geometry"]):
            rings = []
            for ri, ring in enumerate(poly):
                s = simplify_ring(ring)
                if s is None:
                    continue
                if ri == 0:
                    total_area += ring_area(s)
                rings.append(s)
            if rings and len(rings[0]) >= 4:
                polys.append(rings)
        if not polys:
            continue
        pop = p.get("POP_EST") or 0
        gdp = p.get("GDP_MD") or 0  # millions USD
        lx, ly = p.get("LABEL_X"), p.get("LABEL_Y")
        if lx is None:
            # fallback: centroid of largest polygon's outer ring
            big = max(polys, key=lambda pl: ring_area(pl[0]))[0]
            lx = sum(c[0] for c in big) / len(big)
            ly = sum(c[1] for c in big) / len(big)
        countries.append({
            "id": iso,
            "name": name,
            "continent": p.get("CONTINENT"),
            "region": p.get("SUBREGION"),
            "pop": int(pop),
            "gdp": int(gdp),
            "area": round(total_area, 2),
            "label": [round(lx, 2), round(ly, 2)],
            "minZoom": p.get("MIN_LABEL") or 5,
            "polys": polys,
        })

    cities = []
    for f in json.loads(CITIES.read_text(encoding="utf-8"))["features"]:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        cities.append({
            "name": p.get("name"),
            "iso": p.get("adm0_a3"),
            "pop": int(p.get("pop_max") or 0),
            "capital": 1 if (p.get("adm0cap") or 0) >= 1 else 0,
            "ll": [round(lon, 2), round(lat, 2)],
        })

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"countries": countries, "cities": cities}, separators=(",", ":")), encoding="utf-8")
    pts = sum(len(r) for c in countries for pl in c["polys"] for r in pl)
    print(f"countries={len(countries)} cities={len(cities)} points={pts} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
