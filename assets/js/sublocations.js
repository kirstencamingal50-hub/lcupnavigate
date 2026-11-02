// Central Sub-Locations & Facility Mapping Data
const campusSubLocations = {
  "st-augustine": [
    "Registrar",
    "Finance",
    "President’s Office",
    "CITE Office",
    "Truth Courier",
    "SA AVR"
  ],
  "barcie-center": [
    "Main Lobby",
    "Rambutan Hall",
    "Bayabas Hall",
    "Atis Hall",
    "Langka Coffee Shop",
    "Mini Pool and Cottage"
  ],
  "college-of-medicine": [
    "COM AVR",
    "COM Laboratory",
    "Human Anatomy Laboratory"
  ],
  "mother-rita": [
    "BED Library",
    "BED Science Lab",
    "BED Computer Lab"
  ],
  "cafe-monica": [],
  "sto-nino": [],
  "padre-pio": [],
  "our-lady-of-good-counsel": [],
  "kalinangan-auditorium": [],
  "clinic": [],
  "adeodatus-swimming-pool": [],
  "andrada-court": [],
  "cassicasium-court": [],
  "miniforest": [],
  "carthage": [],
  "chapel": [],
  "villa-sta-monica": [],
  "agustino-farm": []
};

function getSubLocations(buildingId) {
  return campusSubLocations[buildingId] || [];
}