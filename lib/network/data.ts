import type { LineDef } from "../types";

// Schematic coordinate system: x right, y down, roughly 1 unit per
// couple of stations. Scaled up when rendered to SVG.
export type XY = [number, number];

// Manually placed stations: city core, interchanges and line termini.
// Everything else is interpolated evenly along the arm between two anchors.
export const ANCHORS: Record<string, XY> = {
  // City core + loop
  "flinders-street": [0, 0],
  "southern-cross": [-1.5, -0.5],
  flagstaff: [-1.5, -2],
  "melbourne-central": [-0.3, -2.6],
  parliament: [1, -2],
  "north-melbourne": [-3, -1.5],
  richmond: [2.5, 1],
  jolimont: [2.3, -0.7],
  "south-yarra": [3, 2.5],
  // Metro Tunnel
  arden: [-2.7, -3.2],
  parkville: [-1.5, -3.8],
  "state-library": [-0.3, -3.4],
  "town-hall": [0.4, -1.2],
  anzac: [1.8, 2.2],
  // West
  footscray: [-5, -1.5],
  newport: [-7.5, 1],
  laverton: [-10.5, 3.5],
  werribee: [-13, 6],
  williamstown: [-8.5, 3.5],
  sunshine: [-7.5, -3],
  sunbury: [-12, -7.5],
  // North
  essendon: [-4.5, -4.5],
  broadmeadows: [-6, -8],
  craigieburn: [-7, -11],
  coburg: [-2.5, -6.5],
  upfield: [-3, -10],
  // North-east
  "clifton-hill": [2.5, -4],
  reservoir: [2, -7.5],
  mernda: [3.5, -12],
  heidelberg: [5.5, -6.5],
  hurstbridge: [9, -10],
  // East
  burnley: [4, 1],
  camberwell: [7, 0.5],
  ringwood: [12, -1.5],
  belgrave: [15.5, 1.5],
  lilydale: [15, -3.5],
  alamein: [8.5, 3],
  "glen-waverley": [10, 4],
  // South-east
  caulfield: [5, 4.5],
  dandenong: [10, 9],
  pakenham: [15, 12.5],
  "east-pakenham": [16, 13.2],
  cranbourne: [11.5, 12],
  moorabbin: [5.5, 8],
  frankston: [7, 14],
  "stony-point": [10, 17],
  sandringham: [3.5, 9.5],
};

// Arms: [fromAnchor, toAnchor, stations interpolated between them in order].
export const ARMS: [string, string, string[]][] = [
  // West trunk + branches
  ["north-melbourne", "footscray", ["south-kensington"]],
  ["footscray", "newport", ["seddon", "yarraville", "spotswood"]],
  // Altona loop drawn in-line (most stopping services run via the loop)
  ["newport", "laverton", ["seaholme", "altona", "westona"]],
  ["laverton", "werribee", ["aircraft", "williams-landing", "hoppers-crossing"]],
  ["newport", "williamstown", ["north-williamstown", "williamstown-beach"]],
  // Sunbury
  ["footscray", "sunshine", ["middle-footscray", "west-footscray", "tottenham"]],
  [
    "sunshine",
    "sunbury",
    ["albion", "ginifer", "st-albans", "keilor-plains", "watergardens", "diggers-rest"],
  ],
  // Craigieburn
  ["north-melbourne", "essendon", ["kensington", "newmarket", "ascot-vale", "moonee-ponds"]],
  [
    "essendon",
    "broadmeadows",
    ["glenbervie", "strathmore", "pascoe-vale", "oak-park", "glenroy", "jacana"],
  ],
  ["broadmeadows", "craigieburn", ["coolaroo", "roxburgh-park"]],
  // Upfield
  [
    "north-melbourne",
    "coburg",
    ["macaulay", "flemington-bridge", "royal-park", "jewell", "brunswick", "anstey", "moreland"],
  ],
  ["coburg", "upfield", ["batman", "merlynston", "fawkner", "gowrie"]],
  // Clifton Hill group
  ["jolimont", "clifton-hill", ["west-richmond", "north-richmond", "collingwood", "victoria-park"]],
  [
    "clifton-hill",
    "reservoir",
    ["rushall", "merri", "northcote", "croxton", "thornbury", "bell", "preston", "regent"],
  ],
  [
    "reservoir",
    "mernda",
    ["ruthven", "keon-park", "thomastown", "lalor", "epping", "south-morang", "middle-gorge", "hawkstowe"],
  ],
  [
    "clifton-hill",
    "heidelberg",
    ["westgarth", "dennis", "fairfield", "alphington", "darebin", "ivanhoe", "eaglemont"],
  ],
  [
    "heidelberg",
    "hurstbridge",
    ["rosanna", "macleod", "watsonia", "greensborough", "montmorency", "eltham", "diamond-creek", "wattle-glen"],
  ],
  // Burnley group
  ["richmond", "burnley", ["east-richmond"]],
  ["burnley", "camberwell", ["hawthorn", "glenferrie", "auburn"]],
  [
    "camberwell",
    "ringwood",
    [
      "east-camberwell",
      "canterbury",
      "chatham",
      "union",
      "box-hill",
      "laburnum",
      "blackburn",
      "nunawading",
      "mitcham",
      "heatherdale",
    ],
  ],
  [
    "ringwood",
    "belgrave",
    ["heathmont", "bayswater", "boronia", "ferntree-gully", "upper-ferntree-gully", "upwey", "tecoma"],
  ],
  ["ringwood", "lilydale", ["ringwood-east", "croydon", "mooroolbark"]],
  ["camberwell", "alamein", ["riversdale", "willison", "hartwell", "burwood", "ashburton"]],
  [
    "burnley",
    "glen-waverley",
    [
      "heyington",
      "kooyong",
      "tooronga",
      "gardiner",
      "glen-iris",
      "darling",
      "east-malvern",
      "holmesglen",
      "jordanville",
      "mount-waverley",
      "syndal",
    ],
  ],
  // Caulfield group
  ["south-yarra", "caulfield", ["hawksburn", "toorak", "armadale", "malvern"]],
  [
    "caulfield",
    "dandenong",
    [
      "carnegie",
      "murrumbeena",
      "hughesdale",
      "oakleigh",
      "huntingdale",
      "clayton",
      "westall",
      "springvale",
      "sandown-park",
      "noble-park",
      "yarraman",
    ],
  ],
  [
    "dandenong",
    "pakenham",
    ["hallam", "narre-warren", "berwick", "beaconsfield", "officer", "cardinia-road"],
  ],
  ["dandenong", "cranbourne", ["lynbrook", "merinda-park"]],
  ["caulfield", "moorabbin", ["glenhuntly", "ormond", "mckinnon", "bentleigh", "patterson"]],
  [
    "moorabbin",
    "frankston",
    [
      "highett",
      "southland",
      "cheltenham",
      "mentone",
      "parkdale",
      "mordialloc",
      "aspendale",
      "edithvale",
      "chelsea",
      "bonbeach",
      "carrum",
      "seaford",
      "kananook",
    ],
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
      "prahran",
      "windsor",
      "balaclava",
      "ripponlea",
      "elsternwick",
      "gardenvale",
      "north-brighton",
      "middle-brighton",
      "brighton-beach",
      "hampton",
    ],
  ],
];

// Official PTV group colours.
const GREEN = "#028430"; // cross-city (Werribee / Williamstown / Frankston)
const YELLOW = "#FFB531"; // northern (Sunbury / Craigieburn / Upfield)
const CYAN = "#279FD5"; // Caulfield group (Pakenham / Cranbourne)
const RED = "#BE1014"; // Clifton Hill group (Mernda / Hurstbridge)
const NAVY = "#152C6B"; // Burnley group
const PINK = "#F178AF"; // Sandringham
const GREY = "#77828C"; // Stony Point shuttle

// Metro Tunnel core shared by Sunbury / Pakenham / Cranbourne through-running.
const TUNNEL = ["footscray", "arden", "parkville", "state-library", "town-hall", "anzac", "caulfield"];

export const LINES: LineDef[] = [
  {
    id: "werribee",
    name: "Werribee",
    color: GREEN,
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
    color: GREEN,
    stations: [
      "flinders-street", "southern-cross", "north-melbourne", "south-kensington",
      "footscray", "seddon", "yarraville", "spotswood", "newport",
      "north-williamstown", "williamstown-beach", "williamstown",
    ],
  },
  {
    id: "sunbury",
    name: "Sunbury",
    color: YELLOW,
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
    color: GREY,
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

// City Loop ring stations (drawn as a shared ring, not per-line edges).
export const CITY_LOOP = [
  "flinders-street",
  "southern-cross",
  "flagstaff",
  "melbourne-central",
  "parliament",
];
