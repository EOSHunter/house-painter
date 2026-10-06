// Dumps house-data.js (the single source of truth) to house.json for the Blender build.
//   node export_house_json.js
const fs = require('fs'), path = require('path');
global.window = {};
require('./house-data.js');
fs.writeFileSync(path.join(__dirname, 'house.json'), JSON.stringify(global.window.HOUSE, null, 1));
console.log('wrote house.json —', global.window.HOUSE.walls.length, 'walls,', global.window.HOUSE.fixtures.length, 'fixtures');
