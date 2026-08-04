"""One-shot helper: trace the City Loop ring lanes off the poster raster.

Prints an `edges` fragment to paste into data/map-overrides.json. Each colour
group gets its own lane, offset perpendicular to the ring centreline, matching
how the poster draws four parallel loops.

Run: python scripts/trace_loop_ring.py
"""
import json
import math

STATIONS = json.load(open("data/map-stations.json"))["stations"]

# Ring anchors in drawn order around the loop.
RING = ["flinders-street", "southern-cross", "flagstaff", "melbourne-central", "parliament"]

# Perpendicular offset per group, in poster pixels, measured off the artwork:
# the four lanes sit inside one another. Negative is towards the ring centre.
LANE = {"YELLOW": -18.0, "RED": -6.0, "NAVY": 6.0, "GREEN": 18.0}


def offset_segment(a, b, d):
    """Shift the segment a->b sideways by d pixels."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1.0
    px, py = -dy / n * d, dx / n * d
    return [a[0] + px, a[1] + py], [b[0] + px, b[1] + py]


def main():
    out = {}
    for group, d in LANE.items():
        for i in range(len(RING)):
            a_id, b_id = RING[i], RING[(i + 1) % len(RING)]
            a, b = STATIONS[a_id], STATIONS[b_id]
            pa, pb = offset_segment(a, b, d)
            out[f"{group}:{a_id}-{b_id}"] = [
                [round(a[0], 1), round(a[1], 1)],
                [round(pa[0], 1), round(pa[1], 1)],
                [round(pb[0], 1), round(pb[1], 1)],
                [round(b[0], 1), round(b[1], 1)],
            ]
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
