import type { LineDef, LineId } from "../types";

// Schematic coordinate system: x right, y down, roughly 1 unit per
// couple of stations. Scaled up when rendered to SVG.
export type XY = [number, number];

// Manually placed stations: city core, interchanges, line termini and bend
// points. Everything else is interpolated evenly along the arm between two
// anchors. Geometry follows the official Victorian train network map:
// horizontal / vertical / 45-degree runs, bends placed at stations, City
// Loop drawn as a box, Altona loop as a dip.
export const ANCHORS: Record<string, XY> = {
  // City Loop box
  "flinders-street": [0, 1.2],
  "southern-cross": [-1.8, 0.6],
  flagstaff: [-1.8, -1.4],
  "melbourne-central": [-0.4, -1.4],
  parliament: [1.2, -1.4],
  // Metro Tunnel
  arden: [-3.0, -2.4],
  parkville: [-1.6, -3.0],
  "state-library": [-0.4, -2.4],
  "town-hall": [0.5, 0.2],
  anzac: [1.6, 3.0],
  // Hubs
  "north-melbourne": [-3.2, -1.4],
  richmond: [2.6, 1.2],
  jolimont: [2.0, -0.4],
  "south-yarra": [2.6, 3.0],
  // West
  footscray: [-5.2, -1.4],
  newport: [-8.6, 2.0],
  seaholme: [-9.5, 2.9],
  altona: [-10.6, 3.4],
  westona: [-11.7, 2.9],
  laverton: [-12.6, 2.0],
  werribee: [-16.6, 2.0],
  williamstown: [-8.6, 5.0],
  sunshine: [-8.6, -4.8],
  sunbury: [-14.55, -10.75],
  // North
  kensington: [-4.0, -2.2],
  newmarket: [-4.8, -3.0],
  craigieburn: [-4.8, -13.0],
  macaulay: [-2.4, -2.2],
  upfield: [-2.4, -12.0],
  // North-east
  "north-richmond": [3.6, -2.0],
  "clifton-hill": [3.6, -5.0],
  mernda: [3.6, -17.0],
  hurstbridge: [12.6, -14.0],
  // East
  burnley: [4.6, 1.2],
  heyington: [5.4, 2.0],
  kooyong: [6.2, 2.8],
  "glen-waverley": [16.2, 2.8],
  camberwell: [8.6, 1.2],
  riversdale: [9.4, 2.0],
  alamein: [9.4, 6.5],
  ringwood: [19.6, 1.2],
  belgrave: [26.0, 7.6],
  lilydale: [22.8, -2.0],
  // South-east
  caulfield: [5.1, 6.0],
  oakleigh: [8.1, 8.4],
  dandenong: [16.1, 8.4],
  pakenham: [21.7, 14.0],
  "east-pakenham": [22.7, 14.0],
  cranbourne: [16.1, 12.0],
  mordialloc: [5.1, 15.8],
  frankston: [9.9, 21.4],
  "stony-point": [14.7, 25.0],
  sandringham: [2.6, 12.9],
};

// Arms: [fromAnchor, toAnchor, stations interpolated between them in order].
export const ARMS: [string, string, string[]][] = [
  // West trunk + branches
  ["north-melbourne", "footscray", ["south-kensington"]],
  ["footscray", "newport", ["seddon", "yarraville", "spotswood"]],
  // Altona loop stations are all anchors (drawn as a dip)
  ["laverton", "werribee", ["aircraft", "williams-landing", "hoppers-crossing"]],
  ["newport", "williamstown", ["north-williamstown", "williamstown-beach"]],
  // Sunbury (45° out from Footscray)
  ["footscray", "sunshine", ["middle-footscray", "west-footscray", "tottenham"]],
  [
    "sunshine",
    "sunbury",
    ["albion", "ginifer", "st-albans", "keilor-plains", "watergardens", "diggers-rest"],
  ],
  // Craigieburn (45° to Newmarket then straight up)
  [
    "newmarket",
    "craigieburn",
    [
      "ascot-vale", "moonee-ponds", "essendon", "glenbervie", "strathmore",
      "pascoe-vale", "oak-park", "glenroy", "jacana", "broadmeadows",
      "coolaroo", "roxburgh-park",
    ],
  ],
  // Upfield (45° to Macaulay then straight up)
  [
    "macaulay",
    "upfield",
    [
      "flemington-bridge", "royal-park", "jewell", "brunswick", "anstey",
      "moreland", "coburg", "batman", "merlynston", "fawkner", "gowrie",
    ],
  ],
  // Clifton Hill group (45° to North Richmond then straight up)
  ["jolimont", "north-richmond", ["west-richmond"]],
  ["north-richmond", "clifton-hill", ["collingwood", "victoria-park"]],
  [
    "clifton-hill",
    "mernda",
    [
      "rushall", "merri", "northcote", "croxton", "thornbury", "bell",
      "preston", "regent", "reservoir", "ruthven", "keon-park", "thomastown",
      "lalor", "epping", "south-morang", "middle-gorge", "hawkstowe",
    ],
  ],
  [
    "clifton-hill",
    "hurstbridge",
    [
      "westgarth", "dennis", "fairfield", "alphington", "darebin", "ivanhoe",
      "eaglemont", "heidelberg", "rosanna", "macleod", "watsonia",
      "greensborough", "montmorency", "eltham", "diamond-creek", "wattle-glen",
    ],
  ],
  // Burnley group
  ["richmond", "burnley", ["east-richmond"]],
  ["burnley", "camberwell", ["hawthorn", "glenferrie", "auburn"]],
  [
    "camberwell",
    "ringwood",
    [
      "east-camberwell", "canterbury", "chatham", "union", "box-hill",
      "laburnum", "blackburn", "nunawading", "mitcham", "heatherdale",
    ],
  ],
  [
    "ringwood",
    "belgrave",
    ["heathmont", "bayswater", "boronia", "ferntree-gully", "upper-ferntree-gully", "upwey", "tecoma"],
  ],
  ["ringwood", "lilydale", ["ringwood-east", "croydon", "mooroolbark"]],
  ["riversdale", "alamein", ["willison", "hartwell", "burwood", "ashburton"]],
  // Glen Waverley (45° to Kooyong then straight right)
  [
    "kooyong",
    "glen-waverley",
    [
      "tooronga", "gardiner", "glen-iris", "darling", "east-malvern",
      "holmesglen", "jordanville", "mount-waverley", "syndal",
    ],
  ],
  // Caulfield group
  ["south-yarra", "caulfield", ["hawksburn", "toorak", "armadale", "malvern"]],
  ["caulfield", "oakleigh", ["carnegie", "murrumbeena", "hughesdale"]],
  [
    "oakleigh",
    "dandenong",
    ["huntingdale", "clayton", "westall", "springvale", "sandown-park", "noble-park", "yarraman"],
  ],
  [
    "dandenong",
    "pakenham",
    ["hallam", "narre-warren", "berwick", "beaconsfield", "officer", "cardinia-road"],
  ],
  ["dandenong", "cranbourne", ["lynbrook", "merinda-park"]],
  [
    "caulfield",
    "mordialloc",
    [
      "glenhuntly", "ormond", "mckinnon", "bentleigh", "patterson", "moorabbin",
      "highett", "southland", "cheltenham", "mentone", "parkdale",
    ],
  ],
  [
    "mordialloc",
    "frankston",
    ["aspendale", "edithvale", "chelsea", "bonbeach", "carrum", "seaford", "kananook"],
  ],
  [
    "frankston",
    "stony-point",
    ["leawarra", "baxter", "somerville", "tyabb", "hastings", "bittern", "morradoo", "crib-point"],
  ],
  [
    "south-yarra",
    "sandringham",
    [
      "prahran", "windsor", "balaclava", "ripponlea", "elsternwick", "gardenvale",
      "north-brighton", "middle-brighton", "brighton-beach", "hampton",
    ],
  ],
];

// Official line-group colours from the 2026 network map.
const PINK = "#F581B6"; // Werribee / Williamstown / Sandringham
const CYAN = "#00A2E2"; // Sunbury / Cranbourne / Pakenham (Metro Tunnel)
const YELLOW = "#F6BE00"; // Craigieburn / Upfield
const RED = "#CC132E"; // Mernda / Hurstbridge
const NAVY = "#004B99"; // Lilydale / Belgrave / Alamein / Glen Waverley
const GREEN = "#00953C"; // Frankston
const LGREEN = "#4CB05C"; // Stony Point

// Metro Tunnel core shared by Sunbury / Pakenham / Cranbourne through-running.
const TUNNEL = ["footscray", "arden", "parkville", "state-library", "town-hall", "anzac", "caulfield"];

export const LINES: LineDef[] = [
  {
    id: "werribee",
    name: "Werribee",
    color: PINK,
    stations: [
      "flinders-street", "southern-cross", "north-melbourne", "south-kensington",
      "footscray", "seddon", "yarraville", "spotswood", "newport",
      "seaholme", "altona", "westona", "laverton",
      "aircraft", "williams-landing", "hoppers-crossing", "werribee",
    ],
  },
  {
    id: "williamstown",
    name: "Williamstown",
    color: PINK,
    stations: [
      "flinders-street", "southern-cross", "north-melbourne", "south-kensington",
      "footscray", "seddon", "yarraville", "spotswood", "newport",
      "north-williamstown", "williamstown-beach", "williamstown",
    ],
  },
  {
    id: "sunbury",
    name: "Sunbury",
    color: CYAN,
    stations: [
      ...TUNNEL.slice().reverse().slice(0, 6), // caulfield..arden (city end shown via tunnel)
      "footscray", "middle-footscray", "west-footscray", "tottenham",
      "sunshine", "albion", "ginifer", "st-albans", "keilor-plains",
      "watergardens", "diggers-rest", "sunbury",
    ],
  },
  {
    id: "craigieburn",
    name: "Craigieburn",
    color: YELLOW,
    stations: [
      "flinders-street", "southern-cross", "north-melbourne",
      "kensington", "newmarket", "ascot-vale", "moonee-ponds", "essendon",
      "glenbervie", "strathmore", "pascoe-vale", "oak-park", "glenroy", "jacana",
      "broadmeadows", "coolaroo", "roxburgh-park", "craigieburn",
    ],
  },
  {
    id: "upfield",
    name: "Upfield",
    color: YELLOW,
    stations: [
      "flinders-street", "southern-cross", "north-melbourne",
      "macaulay", "flemington-bridge", "royal-park", "jewell", "brunswick",
      "anstey", "moreland", "coburg", "batman", "merlynston", "fawkner",
      "gowrie", "upfield",
    ],
  },
  {
    id: "mernda",
    name: "Mernda",
    color: RED,
    stations: [
      "flinders-street", "jolimont", "west-richmond", "north-richmond",
      "collingwood", "victoria-park", "clifton-hill",
      "rushall", "merri", "northcote", "croxton", "thornbury", "bell",
      "preston", "regent", "reservoir", "ruthven", "keon-park", "thomastown",
      "lalor", "epping", "south-morang", "middle-gorge", "hawkstowe", "mernda",
    ],
  },
  {
    id: "hurstbridge",
    name: "Hurstbridge",
    color: RED,
    stations: [
      "flinders-street", "jolimont", "west-richmond", "north-richmond",
      "collingwood", "victoria-park", "clifton-hill",
      "westgarth", "dennis", "fairfield", "alphington", "darebin",
      "ivanhoe", "eaglemont", "heidelberg", "rosanna", "macleod", "watsonia",
      "greensborough", "montmorency", "eltham", "diamond-creek", "wattle-glen", "hurstbridge",
    ],
  },
  {
    id: "belgrave",
    name: "Belgrave",
    color: NAVY,
    stations: [
      "flinders-street", "richmond", "east-richmond", "burnley",
      "hawthorn", "glenferrie", "auburn", "camberwell",
      "east-camberwell", "canterbury", "chatham", "union", "box-hill",
      "laburnum", "blackburn", "nunawading", "mitcham", "heatherdale", "ringwood",
      "heathmont", "bayswater", "boronia", "ferntree-gully",
      "upper-ferntree-gully", "upwey", "tecoma", "belgrave",
    ],
  },
  {
    id: "lilydale",
    name: "Lilydale",
    color: NAVY,
    stations: [
      "flinders-street", "richmond", "east-richmond", "burnley",
      "hawthorn", "glenferrie", "auburn", "camberwell",
      "east-camberwell", "canterbury", "chatham", "union", "box-hill",
      "laburnum", "blackburn", "nunawading", "mitcham", "heatherdale", "ringwood",
      "ringwood-east", "croydon", "mooroolbark", "lilydale",
    ],
  },
  {
    id: "alamein",
    name: "Alamein",
    color: NAVY,
    stations: [
      "flinders-street", "richmond", "east-richmond", "burnley",
      "hawthorn", "glenferrie", "auburn", "camberwell",
      "riversdale", "willison", "hartwell", "burwood", "ashburton", "alamein",
    ],
  },
  {
    id: "glen-waverley",
    name: "Glen Waverley",
    color: NAVY,
    stations: [
      "flinders-street", "richmond", "east-richmond", "burnley",
      "heyington", "kooyong", "tooronga", "gardiner", "glen-iris", "darling",
      "east-malvern", "holmesglen", "jordanville", "mount-waverley", "syndal", "glen-waverley",
    ],
  },
  {
    id: "pakenham",
    name: "Pakenham",
    color: CYAN,
    stations: [
      ...TUNNEL, // footscray..caulfield (through-running city end)
      "carnegie", "murrumbeena", "hughesdale", "oakleigh", "huntingdale",
      "clayton", "westall", "springvale", "sandown-park", "noble-park",
      "yarraman", "dandenong", "hallam", "narre-warren", "berwick",
      "beaconsfield", "officer", "cardinia-road", "pakenham", "east-pakenham",
    ],
  },
  {
    id: "cranbourne",
    name: "Cranbourne",
    color: CYAN,
    stations: [
      ...TUNNEL,
      "carnegie", "murrumbeena", "hughesdale", "oakleigh", "huntingdale",
      "clayton", "westall", "springvale", "sandown-park", "noble-park",
      "yarraman", "dandenong", "lynbrook", "merinda-park", "cranbourne",
    ],
  },
  {
    id: "frankston",
    name: "Frankston",
    color: GREEN,
    stations: [
      "flinders-street", "richmond", "south-yarra",
      "hawksburn", "toorak", "armadale", "malvern", "caulfield",
      "glenhuntly", "ormond", "mckinnon", "bentleigh", "patterson", "moorabbin",
      "highett", "southland", "cheltenham", "mentone", "parkdale", "mordialloc",
      "aspendale", "edithvale", "chelsea", "bonbeach", "carrum", "seaford",
      "kananook", "frankston",
    ],
  },
  {
    id: "sandringham",
    name: "Sandringham",
    color: PINK,
    stations: [
      "flinders-street", "richmond", "south-yarra",
      "prahran", "windsor", "balaclava", "ripponlea", "elsternwick",
      "gardenvale", "north-brighton", "middle-brighton", "brighton-beach",
      "hampton", "sandringham",
    ],
  },
  {
    id: "stony-point",
    name: "Stony Point",
    color: LGREEN,
    stations: [
      "frankston", "leawarra", "baxter", "somerville", "tyabb", "hastings",
      "bittern", "morradoo", "crib-point", "stony-point",
    ],
  },
];

// Display-name overrides where kebab->Title Case isn't right.
export const NAME_OVERRIDES: Record<string, string> = {
  mckinnon: "McKinnon",
  "st-albans": "St Albans",
  "upper-ferntree-gully": "Upper Ferntree Gully",
  anzac: "Anzac",
};

export interface LoopGroup {
  color: string;
  lines: LineId[];
  // Loop stations in travel order OUTBOUND from Flinders Street — the order a
  // train leaving Flinders Street via the loop calls at them. Northern runs the
  // ring the other way round from the rest, which is why this is per-group.
  order: string[];
  // Trunk station where this group's loop rejoins its own line.
  portal: string;
}

// The City Loop is an overlay, not a line: it is deliberately NOT spliced into
// the LINES arrays above, because extract_map.py, the geometry build, the map
// edge ids and the scraper's station matching all key off those arrays.
export const LOOP: { ring: string[]; groups: LoopGroup[] } = {
  ring: ["flinders-street", "southern-cross", "flagstaff", "melbourne-central", "parliament"],
  groups: [
    {
      color: YELLOW,
      lines: ["craigieburn", "upfield"],
      order: ["parliament", "melbourne-central", "flagstaff"],
      portal: "north-melbourne",
    },
    {
      color: RED,
      lines: ["mernda", "hurstbridge"],
      order: ["southern-cross", "flagstaff", "melbourne-central", "parliament"],
      portal: "jolimont",
    },
    {
      color: NAVY,
      lines: ["belgrave", "lilydale", "alamein", "glen-waverley"],
      order: ["southern-cross", "flagstaff", "melbourne-central", "parliament"],
      portal: "richmond",
    },
    {
      color: GREEN,
      lines: ["frankston"],
      order: ["southern-cross", "flagstaff", "melbourne-central", "parliament"],
      portal: "richmond",
    },
  ],
};
