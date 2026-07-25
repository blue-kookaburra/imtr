# One-off extraction: official network map PDF -> high-res raster +
# station-id -> pixel coordinates JSON for the status overlay.
#
# The PDF has no text layer (labels are outlined), so labels come from
# Tesseract OCR over the raster; each label is then snapped to the nearest
# point of a vector line path whose colour belongs to that station's lines.
# Run: python scripts/extract_map.py
import json
import re
import fitz
import pytesseract
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

SCALE = 3.0
PDF = "docs/official-map.pdf"

# True stroke colours sampled from the PDF (0-1 floats).
LINE_COLOURS = {
    "pink": (0.962, 0.504, 0.714),   # Werribee / Williamstown / Sandringham
    "cyan": (0.0, 0.634, 0.887),     # Sunbury / Cranbourne / Pakenham
    "yellow": (0.963, 0.746, 0.0),   # Craigieburn / Upfield
    "red": (0.8, 0.073, 0.179),      # Mernda / Hurstbridge
    "navy": (0.0, 0.294, 0.602),     # Burnley group
    "green": (0.0, 0.583, 0.237),    # Frankston / Stony Point
}

LINE_TO_COLOURS = {
    "werribee": ["pink"], "williamstown": ["pink"], "sandringham": ["pink"],
    "sunbury": ["cyan"], "pakenham": ["cyan"], "cranbourne": ["cyan"],
    "craigieburn": ["yellow"], "upfield": ["yellow"],
    "mernda": ["red"], "hurstbridge": ["red"],
    "belgrave": ["navy"], "lilydale": ["navy"], "alamein": ["navy"], "glen-waverley": ["navy"],
    "frankston": ["green"], "stony-point": ["green"],
}

OVERRIDES = {"mckinnon": "McKinnon", "st-albans": "St Albans", "glenhuntly": "Glen Huntly"}


def title(sid):
    return OVERRIDES.get(sid) or " ".join(w.capitalize() for w in sid.split("-"))


def station_lines_from_data():
    src = open("lib/network/data.ts", encoding="utf-8").read()
    lines_block = src[src.index("export const LINES"):]
    station_lines = {}
    for m in re.finditer(r'id:\s*"([a-z-]+)"[\s\S]*?stations:\s*\[([^\]]+)\]', lines_block):
        lid, body = m.group(1), m.group(2)
        for s in re.findall(r'"([a-z0-9-]+)"', body):
            station_lines.setdefault(s, set()).add(lid)
    tunnel = ["footscray", "arden", "parkville", "state-library", "town-hall", "anzac", "caulfield"]
    for lid in ("sunbury", "pakenham", "cranbourne"):
        for s in tunnel:
            station_lines.setdefault(s, set()).add(lid)
    for s in ("flinders-street", "southern-cross", "flagstaff", "melbourne-central", "parliament"):
        station_lines.setdefault(s, set()).update(LINE_TO_COLOURS.keys())
    return station_lines


def collect_colour_chains(page):
    """Per colour: list of polylines (one per drawn path), densified."""

    def close(c, target):
        return c and all(abs(a - b) <= 0.09 for a, b in zip(c, target))

    chains = {k: [] for k in LINE_COLOURS}
    for d in page.get_drawings():
        col = d.get("color")
        r = d.get("rect")
        if r and in_legend((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2):
            continue
        for name, rgb in LINE_COLOURS.items():
            if close(col, rgb):
                pts = []
                for item in d["items"]:
                    if item[0] == "l":
                        p1, p2 = item[1], item[2]
                        n = max(2, int(p1.distance_to(p2) / 3))
                        for i in range(n + 1):
                            t = i / n
                            pts.append((p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t))
                    elif item[0] == "c":
                        p0, c1, c2, p3 = item[1], item[2], item[3], item[4]
                        for i in range(13):
                            t = i / 12
                            mt = 1 - t
                            x = mt**3 * p0.x + 3 * mt**2 * t * c1.x + 3 * mt * t**2 * c2.x + t**3 * p3.x
                            y = mt**3 * p0.y + 3 * mt**2 * t * c1.y + 3 * mt * t**2 * c2.y + t**3 * p3.y
                            pts.append((x, y))
                if len(pts) >= 2:
                    chains[name].append(pts)
                break
    return chains


def collect_colour_points(chains):
    return {k: [p for chain in v for p in chain] for k, v in chains.items()}


# Legend box (bottom-left) contains line names and colour swatches that
# would otherwise hijack label matching. PDF-point space.
def in_legend(x_pt, y_pt):
    return x_pt < 460 and y_pt > 540


def ocr_words(img_path, min_conf=40):
    img = Image.open(img_path)
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, config="--psm 11")
    words = []
    for i in range(len(data["text"])):
        t = data["text"][i].strip()
        if t and int(data["conf"][i]) > min_conf:
            x = data["left"][i] + data["width"][i] / 2
            y = data["top"][i] + data["height"][i] / 2
            if in_legend(x / SCALE, y / SCALE):
                continue
            words.append({"t": t, "x": x, "y": y, "l": data["left"][i], "r": data["left"][i] + data["width"][i]})
    return words


def word_matches(a, b, fuzzy):
    a, b = a.lower(), b.lower()
    if a == b:
        return True
    if not fuzzy or abs(len(a) - len(b)) > 1:
        return False
    from difflib import SequenceMatcher

    return SequenceMatcher(None, a, b).ratio() >= 0.8 and len(b) >= 4


def find_label(words, name, fuzzy=False):
    """All candidate centres for a (possibly multi-word) station name."""
    parts = name.split(" ")
    cands = []
    for i, w in enumerate(words):
        if not word_matches(w["t"], parts[0], fuzzy):
            continue
        if len(parts) == 1:
            cands.append((w["x"], w["y"]))
            continue
        # chain following words left-to-right on roughly the same baseline,
        # or stacked directly below (two-line labels)
        cur = w
        ok = True
        xs, ys = [w["x"]], [w["y"]]
        for p in parts[1:]:
            nxt = None
            for v in words:
                if not word_matches(v["t"], p, fuzzy):
                    continue
                same_line = abs(v["y"] - cur["y"]) < 14 and 0 < v["l"] - cur["r"] < 40
                below = 8 < v["y"] - cur["y"] < 42 and abs(v["x"] - cur["x"]) < 90
                if same_line or below:
                    nxt = v
                    break
            if not nxt:
                ok = False
                break
            xs.append(nxt["x"])
            ys.append(nxt["y"])
            cur = nxt
        if ok:
            cands.append((sum(xs) / len(xs), sum(ys) / len(ys)))
    return cands


def main():
    doc = fitz.open(PDF)
    page = doc[0]

    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE))
    pix.save("public/network-map.png")
    print(f"raster {pix.width}x{pix.height}")

    chains = collect_colour_chains(page)
    colour_pts = collect_colour_points(chains)
    for k, v in colour_pts.items():
        print(f"colour {k}: {len(v)} pts in {len(chains[k])} chains")

    words = ocr_words("public/network-map.png")
    print(f"OCR words: {len(words)}")

    station_lines = station_lines_from_data()
    out, labels, missing = {}, {}, []
    for sid, lids in station_lines.items():
        cands = find_label(words, title(sid))
        if not cands:
            missing.append(sid)
            continue
        allowed = set()
        for lid in lids:
            allowed.update(LINE_TO_COLOURS.get(lid, []))
        best, bd, blabel = None, 1e18, None
        for (lx, ly) in cands:
            # label coords are raster px; path pts are pdf pts
            plx, ply = lx / SCALE, ly / SCALE
            for cn in allowed:
                for (px, py) in colour_pts[cn]:
                    dd = (px - plx) ** 2 + (py - ply) ** 2
                    if dd < bd:
                        bd, best, blabel = dd, (px, py), (plx, ply)
        if best and bd < 55**2:
            out[sid] = [round(best[0] * SCALE, 1), round(best[1] * SCALE, 1)]
            labels[sid] = blabel
        else:
            missing.append(sid)

    # relaxed second pass for OCR misses
    if missing:
        words2 = ocr_words("public/network-map.png", min_conf=15)
        still = []
        for sid in missing:
            lids = station_lines[sid]
            cands = find_label(words2, title(sid), fuzzy=True)
            allowed = set()
            for lid in lids:
                allowed.update(LINE_TO_COLOURS.get(lid, []))
            best, bd = None, 1e18
            for (lx, ly) in cands:
                plx, ply = lx / SCALE, ly / SCALE
                for cn in allowed:
                    for (px, py) in colour_pts[cn]:
                        dd = (px - plx) ** 2 + (py - ply) ** 2
                        if dd < bd:
                            bd, best = dd, (px, py)
            if best and bd < 55**2:
                out[sid] = [round(best[0] * SCALE, 1), round(best[1] * SCALE, 1)]
            else:
                still.append(sid)
        missing = still

    # final fallback: midpoint of mapped neighbours on the same line
    if missing:
        src = open("lib/network/data.ts", encoding="utf-8").read()
        lines_block = src[src.index("export const LINES"):]
        line_orders = []
        for m in re.finditer(r'stations:\s*\[([^\]]+)\]', lines_block):
            line_orders.append(re.findall(r'"([a-z0-9-]+)"', m.group(1)))
        still = []
        for sid in missing:
            placed = False
            for order in line_orders:
                if sid in order:
                    i = order.index(sid)
                    prev = next((out[s] for s in reversed(order[:i]) if s in out), None)
                    nxt = next((out[s] for s in order[i + 1:] if s in out), None)
                    if prev and nxt:
                        out[sid] = [round((prev[0] + nxt[0]) / 2, 1), round((prev[1] + nxt[1]) / 2, 1)]
                        placed = True
                        break
            if not placed:
                still.append(sid)
        missing = still

    print(f"mapped {len(out)}; missing ({len(missing)}): {sorted(missing)}")

    # --- per-edge overlay paths routed along the drawn line geometry
    src = open("lib/network/data.ts", encoding="utf-8").read()
    lines_block = src[src.index("export const LINES"):]
    line_defs = []
    for m in re.finditer(r'id:\s*"([a-z-]+)"[\s\S]*?stations:\s*\[([^\]]+)\]', lines_block):
        line_defs.append((m.group(1), re.findall(r'"([a-z0-9-]+)"', m.group(2))))
    tunnel = ["footscray", "arden", "parkville", "state-library", "town-hall", "anzac", "caulfield"]
    for i, (lid, sts) in enumerate(line_defs):
        if lid in ("sunbury", "pakenham", "cranbourne") and "arden" not in sts:
            line_defs[i] = (lid, tunnel + sts if lid != "sunbury" else sts)

    # Point graph per colour: consecutive chain points + proximity links
    # bridging separate path objects (the map draws corridors in pieces).
    import heapq
    from collections import defaultdict

    def build_graph(colour_names):
        nodes = []
        adj = defaultdict(list)
        endpoints = []
        for cn in colour_names:
            for chain in chains[cn]:
                start = len(nodes)
                nodes.extend(chain)
                endpoints.extend([start, start + len(chain) - 1])
                for i in range(start, start + len(chain) - 1):
                    d = math_dist(nodes[i], nodes[i + 1])
                    adj[i].append((i + 1, d))
                    adj[i + 1].append((i, d))
        # bridge chain endpoints across interchange-lozenge gaps
        for i in endpoints:
            for j, q in enumerate(nodes):
                if i == j:
                    continue
                d = math_dist(nodes[i], q)
                if d < 16:
                    adj[i].append((j, d * 1.5))  # slight penalty
                    adj[j].append((i, d * 1.5))
        # proximity links via grid hash
        grid = defaultdict(list)
        cell = 4.0
        for i, (x, y) in enumerate(nodes):
            grid[(int(x / cell), int(y / cell))].append(i)
        for i, (x, y) in enumerate(nodes):
            cx, cy = int(x / cell), int(y / cell)
            for gx in (cx - 1, cx, cx + 1):
                for gy in (cy - 1, cy, cy + 1):
                    for j in grid[(gx, gy)]:
                        if j <= i:
                            continue
                        d = math_dist(nodes[i], nodes[j])
                        if d < 3.5:
                            adj[i].append((j, d))
                            adj[j].append((i, d))
        return nodes, adj

    def math_dist(a, b):
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5

    def nearest_node(nodes, p):
        bi, bd = 0, 1e18
        for i, q in enumerate(nodes):
            dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
            if dd < bd:
                bd, bi = dd, i
        return bi, bd**0.5

    def dijkstra(nodes, adj, src, dst):
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w in adj[u]:
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        if dst not in dist:
            return None
        path = [dst]
        while path[-1] != src:
            path.append(prev[path[-1]])
        return [nodes[i] for i in reversed(path)]

    graphs = {}
    edge_paths = {}
    fallback = 0
    for lid, sts in line_defs:
        key = tuple(LINE_TO_COLOURS[lid])
        if key not in graphs:
            graphs[key] = build_graph(key)
        nodes, adj = graphs[key]
        for a, b in zip(sts, sts[1:]):
            eid = f"{lid}:{a}-{b}"
            if a not in out or b not in out:
                continue
            # Snap each endpoint's LABEL to this line's own colour graph —
            # the global station coord may sit on another line's strand at
            # big interchanges.
            pa = labels.get(a) or (out[a][0] / SCALE, out[a][1] / SCALE)
            pb = labels.get(b) or (out[b][0] / SCALE, out[b][1] / SCALE)
            ia, da = nearest_node(nodes, pa)
            ib, db = nearest_node(nodes, pb)
            pa, pb = nodes[ia], nodes[ib]
            sub = dijkstra(nodes, adj, ia, ib) if da < 110 and db < 110 else None
            # sanity: routed path shouldn't be wildly longer than the crow flies
            if sub and len(sub) >= 2:
                arc = sum(math_dist(p, q) for p, q in zip(sub, sub[1:]))
                if arc > max(60.0, 3.5 * math_dist(pa, pb)):
                    sub = None
            if sub and len(sub) >= 2:
                keep = [sub[0]]
                for p in sub[1:-1]:
                    if (p[0] - keep[-1][0]) ** 2 + (p[1] - keep[-1][1]) ** 2 > 9:
                        keep.append(p)
                keep.append(sub[-1])
                edge_paths[eid] = [[round(x * SCALE), round(y * SCALE)] for x, y in keep]
            else:
                fallback += 1
                edge_paths[eid] = [
                    [round(pa[0] * SCALE), round(pa[1] * SCALE)],
                    [round(pb[0] * SCALE), round(pb[1] * SCALE)],
                ]
    print(f"edge paths: {len(edge_paths)} ({fallback} straight fallbacks)")

    json.dump(
        {"width": pix.width, "height": pix.height, "stations": out, "edges": edge_paths},
        open("data/map-stations.json", "w"),
    )


if __name__ == "__main__":
    main()
