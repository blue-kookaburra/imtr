# Build City Loop lane geometry with proper rounded-corner offsetting.
#
# Replaces the straight per-edge perpendicular offset in trace_loop_ring.py:
# that approach can't round corners and can't represent a lane whose path
# genuinely diverges from the ring (Craigieburn/Upfield's direct Flinders
# Street -> Parliament tunnel, which skips Southern Cross).
#
# For each colour group this offsets its own path (not just the 5-station
# ring) by a fixed perpendicular distance, rounding each interior vertex
# with a small arc so adjacent-lane bundles stay nested instead of pinching.
# The result is sliced back into per-station-pair edges and merged into
# data/map-overrides.json, keyed per line the way expand_loop_lanes.ts did.
#
# Run: python scripts/build_loop_geometry.py
import json
import math

STATIONS = json.load(open("data/map-stations.json"))["stations"]

# Perpendicular offset per group, in poster pixels (unchanged from
# trace_loop_ring.py -- measured off the artwork, four lanes nested inside
# one another).
LANE = {"YELLOW": -18.0, "RED": -6.0, "NAVY": 6.0, "GREEN": 18.0}

CORNER_RADIUS = 16.0
ARC_STEPS = 8

# Throat: not a real station. Craigieburn/Upfield's loop tunnel leaves
# Flinders Street heading up through the same corridor as every other loop
# line before bending east to Parliament -- it does not cut a direct
# diagonal across the open interior. Measured off the poster (the tunnel
# mouth sits just north of Flinders Street, roughly under Town Hall).
THROAT = (1685.0, 1200.0)

# Each group's own path in geometric (not calling) order -- this is where
# Yellow diverges from the other three, per lib/network/data.ts LoopGroup.order
# ("Northern runs the ring the other way round from the rest").
GROUP_PATH = {
    "YELLOW": ["flinders-street", THROAT, "parliament", "melbourne-central", "flagstaff"],
    "RED": ["flinders-street", "southern-cross", "flagstaff", "melbourne-central", "parliament"],
    "NAVY": ["flinders-street", "southern-cross", "flagstaff", "melbourne-central", "parliament"],
    "GREEN": ["flinders-street", "southern-cross", "flagstaff", "melbourne-central", "parliament"],
}


def pt(p):
    return STATIONS[p] if isinstance(p, str) else list(p)


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def norm(v):
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n)


def perp_offset(dir_unit, d):
    dx, dy = dir_unit
    return (-dy * d, dx * d)


def add(p, v):
    return [p[0] + v[0], p[1] + v[1]]


def bezier(p0, c, p1, steps):
    """Quadratic bezier from p0 to p1 via control c. Stays inside the
    triangle {p0, c, p1} (convex hull property) -- unlike a circular arc at
    the offset radius, it cannot overshoot past the station or into a
    neighbouring lane, so it is safe for the inner (concave-relative) lanes
    where true polygon-offset arcs self-intersect."""
    pts = []
    for k in range(steps + 1):
        t = k / steps
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0]
        y = mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1]
        pts.append([x, y])
    return pts


def vertex_offsets(points, d, radius, steps):
    """Per vertex: either a single offset point (path endpoints) or a
    rounded corner (interior vertices) -- a short bezier from the edge-own
    offset point on one side to the edge-own offset point on the other,
    pulled toward the real station -- split at its midpoint so the first
    half belongs to the incoming edge and the second half to the outgoing
    edge."""
    n = len(points)
    dirs = [norm(sub(points[i + 1], points[i])) for i in range(n - 1)]
    out = []
    for i in range(n):
        din = dirs[i - 1] if i > 0 else None
        dout = dirs[i] if i < n - 1 else None
        if din is None:
            single = add(points[i], perp_offset(dout, d))
            out.append({"in": [], "out": [single]})
            continue
        if dout is None:
            single = add(points[i], perp_offset(din, d))
            out.append({"in": [single], "out": []})
            continue
        off_in = add(points[i], perp_offset(din, d))
        off_out = add(points[i], perp_offset(dout, d))
        if math.hypot(off_in[0] - off_out[0], off_in[1] - off_out[1]) < 1e-3:
            out.append({"in": [off_in], "out": [off_out]})
            continue
        curve = bezier(off_in, points[i], off_out, steps)
        mid = (steps + 1) // 2
        out.append({"in": curve[:mid], "out": curve[mid:]})
    return out


def build_group_edges(path, d):
    points = [pt(p) for p in path]
    voff = vertex_offsets(points, d, CORNER_RADIUS, ARC_STEPS)
    edges = {}
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        if not isinstance(a, str) or not isinstance(b, str):
            continue  # throat-adjacent edge handled by its real station pair below
        seg = [points[i]] + voff[i]["out"] + voff[i + 1]["in"] + [points[i + 1]]
        edges[f"{a}-{b}"] = seg
    return edges, points, voff


def main():
    ov = json.load(open("data/map-overrides.json"))

    from importlib import import_module  # noqa: F401  (kept import-free below)

    # LOOP.groups lines, mirrored from lib/network/data.ts (kept in sync by
    # hand -- see AGENTS.md network-model section for the source of truth).
    GROUP_LINES = {
        "YELLOW": ["craigieburn", "upfield"],
        "RED": ["mernda", "hurstbridge"],
        "NAVY": ["belgrave", "lilydale", "alamein", "glen-waverley"],
        "GREEN": ["frankston"],
    }

    added = 0
    for group, d in LANE.items():
        path = GROUP_PATH[group]
        points = [pt(p) for p in path]
        voff = vertex_offsets(points, d, CORNER_RADIUS, ARC_STEPS)

        # Build one edge per consecutive pair, using real station ids where
        # possible; the throat sits inside the flinders-street->parliament
        # edge for Yellow, not as its own station.
        for i in range(len(path) - 1):
            a_raw, b_raw = path[i], path[i + 1]
            # walk forward/back past any non-station (throat) waypoints to
            # find the real station ids this edge is keyed under
            a_id = a_raw if isinstance(a_raw, str) else path[i - 1]
            b_id = b_raw if isinstance(b_raw, str) else path[i + 1]
            if not isinstance(a_raw, str) and not isinstance(b_raw, str):
                continue
            if not isinstance(a_raw, str):
                continue  # merged into the previous real->real span below
            # collect this station through to the next real station,
            # concatenating any throat vertices in between
            j = i + 1
            seg_points = [points[i]] + voff[i]["out"]
            while not isinstance(path[j], str):
                seg_points += voff[j]["in"] + voff[j]["out"]
                j += 1
            seg_points += voff[j]["in"] + [points[j]]
            key = f"{a_id}-{path[j]}"
            for lid in GROUP_LINES[group]:
                eid = f"{lid}:{key}"
                ov["edges"][eid] = [[round(x, 1), round(y, 1)] for x, y in seg_points]
                added += 1
            if not isinstance(b_raw, str):
                continue

    json.dump(ov, open("data/map-overrides.json", "w"), indent=2)
    print(f"wrote {added} loop edge(s)")


if __name__ == "__main__":
    main()
