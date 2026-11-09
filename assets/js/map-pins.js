// New campus map data. Image size matches assets/images/campus-map.svg (viewBox 20 240 1330 1620).
// Pin positions are pixel coordinates inside the image: [x, y] measured from the top-left corner.
// Names come from the campus directory sign (floors/offices not included yet).
export const MAP_W = 1330, MAP_H = 1620;
const OX = 20, OY = 240;                       // viewBox origin of the SVG
const px = (x, y) => [x - OX, y - OY];

const tips = {1:[723,1595],2:[782,1535],3:[910,1535],4:[1106,1535],5:[374,1385],6:[519,1385],7:[637,1385],8:[950,1385],9:[1195,1385],10:[298,1143],11:[388,1173],12:[658,1173],13:[766,1173],14:[900,1173],15:[1062,1173],16:[208,1008],17:[388,1007],18:[766,1007],19:[896,1007],20:[1058,1007],21:[208,880],22:[500,880],23:[261,785],24:[411,785],25:[546,785],26:[668,785],27:[790,785],28:[548,677],29:[548,586],30:[623,469],31:[666,469],32:[711,469],33:[814,469],34:[924,469],35:[965,547],36:[1027,547],37:[1156,547],38:[111,1173]};

export const pinNames = {
  1: "Mary Mediatrix Building",
  2: "Sto. Niño Garden",
  3: "Grotto of Our Lady of Lourdes",
  4: "Villa Santa Monica Building",
  5: "Barcelo Cafe Malolos",
  6: "Agostino - CITHM Office",
  7: "Our Lady of Consolacion Rotonda",
  8: "Kalinangan Auditorium",
  9: "UBMSS Fabrication Area",
  10: "VMC Open Stage",
  11: "St. Augustine Administration Building",
  12: "Tagaste Mini Forest",
  13: "Carthage Activity Center",
  14: "Motor Pool",
  15: "Adeodatus Mini Olympic Swimming Pool",
  16: "Mo. Theresa Andrada OSA Gymnasium",
  17: "Venerable Mo. Consuelo Academic Building",
  18: "Chapel of Our Lady of Consolation",
  19: "Cloister",
  20: "Agustino Farm",
  21: "St. Ezekiel Moreno Building",
  22: "Kiosk",
  23: "Ostia Student Lounge",
  24: "Cafe Monica Building",
  25: "Our Lady of Good Counsel Building",
  26: "Mo. Rita Barcelo Building",
  27: "St. Augustine Inner Garden",
  28: "Our Lady of Consolation Building",
  29: "Our Lady of Grace Building",
  30: "Madaura Student Lounge",
  31: "Milan Student Lounge",
  32: "Hippo Student Lounge",
  33: "Cassiciacum Student Center",
  34: "Sto. Nino Building",
  35: "Sto. Nino Grounds",
  36: "St. Rita de Casia Student Lounge",
  37: "St. Padre Pio Building",
  38: "Barcie International Center"
};

export const mapPins = Object.entries(tips).map(([n, [x, y]]) => ({
  id: `pin-${n}`, num: +n, name: pinNames[n], cat: 'building', px: px(x, y)
}));

// Gates (shown as labels on the map image; listed here so they can be searched and used as route points).
export const mapGates = [
  { id: 'gate-1', num: null, name: 'Gate 1', cat: 'gate', px: px(650, 1800) },
  { id: 'gate-2', num: null, name: 'Gate 2', cat: 'gate', px: px(541, 405) }
];

// Walkway junctions that follow the paths on the map (same coordinates as the SVG).
// They are kept in the gaps between buildings so the blue route never cuts through one.
const J = {
  'j:g2': [469,427], 'j:a': [579,518], 'j:b': [639,584], 'j:c': [630,739], 'j:d': [617,954],
  'j:sm1': [650,966], 'j:an': [925,966],
  'j:e': [614,1065], 'j:f': [617,1198], 'j:s1': [679,1249], 'j:s2': [745,1312], 'j:s3': [723,1377], 'j:s4': [686,1426], 'j:rot': [676,1360], 'j:i': [674,1478],
  'j:g1': [682,1559], 'j:g1c': [672,1620], 'j:g1b': [655,1775],
  'j:ne1': [925,662], 'j:ne2': [1108,662], 'j:ne3': [1108,520],
  'j:w1': [400,940], 'j:w2': [250,940], 'j:w3': [255,1030], 'j:bw3': [232,1105], 'j:bw2': [232,1325], 'j:bw1': [450,1325],
  'j:be1': [735,1266], 'j:be2': [1000,1266], 'j:pk3': [990,1200], 'j:pk1': [980,1120], 'j:pk2': [960,992],
  'j:vs1': [900,1478], 'j:vs2': [1045,1478],
  'j:be3': [1120,1505], 'j:g3': [1165,1640], 'j:e1': [905,1565]
};
export const mapJunctions = Object.fromEntries(Object.entries(J).map(([k, [x, y]]) => [k, px(x, y)]));
export const mapBackbone = [
  ['j:g2','j:a'],['j:a','j:b'],['j:b','j:c'],['j:c','j:d'],['j:d','j:e'],['j:e','j:f'],['j:f','j:s1'],['j:s1','j:s2'],['j:s2','j:s3'],['j:s3','j:s4'],['j:s4','j:i'],['j:rot','j:s3'],['j:s2','j:be1'],
  ['j:i','j:g1'],['j:g1','j:g1c'],['j:g1c','j:g1b'],
  ['j:d','j:sm1'],['j:sm1','j:an'],['j:an','j:ne1'],['j:ne1','j:ne2'],['j:ne2','j:ne3'],
  ['j:d','j:w1'],['j:w1','j:w2'],['j:w2','j:w3'],['j:w3','j:bw3'],['j:bw3','j:bw2'],['j:bw2','j:bw1'],['j:bw1','j:rot'],
  ['j:be1','j:be2'],['j:be2','j:pk3'],['j:pk3','j:pk1'],['j:pk1','j:pk2'],['j:pk2','j:an'],
  ['j:be2','j:vs2'],
  ['j:i','j:vs1'],['j:vs1','j:vs2'],['j:vs2','j:be3'],['j:be3','j:g3'],
  ['j:g1','j:e1'],['j:e1','j:vs1']
];
