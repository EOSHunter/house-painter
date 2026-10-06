// Compiles a house file into the plain JSON that build_house.py reads (joined walls, paint surfaces, room shapes).
//   node export_house_json.js [houses/<id>/house.json] [out.json | -]
// Defaults: the example house, written to stdout. build_house.py runs this for you when it is given a house file;
// files from the page's "Export for Blender" already contain the compiled house.
const fs = require('fs'), path = require('path');
const HouseCore = require('./house-core.js');
const srcPath = process.argv[2] || path.join(__dirname, 'houses', 'waterford-4563c', 'house.json');
const outPath = process.argv[3] || '-';
const { HOUSE, ROOMS } = HouseCore.build(JSON.parse(fs.readFileSync(srcPath, 'utf8')));
const text = JSON.stringify(HouseCore.forBlender(HOUSE, ROOMS), null, 1);
if (outPath === '-') process.stdout.write(text);
else {
  fs.writeFileSync(outPath, text);
  console.error(`wrote ${outPath}: ${HOUSE.walls.length} walls, ${HOUSE.fixtures.length} fixtures, ${ROOMS.surfaces.length} surfaces, ${ROOMS.rooms.length} rooms`);
}
