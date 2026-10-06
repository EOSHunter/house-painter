// The example house, built with house-core.js, for the Node scheme scripts: sets window.HOUSE / window.ROOMS.
global.window = global.window || {};
const HouseCore = require('../house-core.js');
const built = HouseCore.build(require('../houses/waterford-4563c/house.json'));
window.HOUSE = built.HOUSE; window.ROOMS = built.ROOMS;
built.SCHEMES_DIR = require('path').join(__dirname, '..', 'houses', 'waterford-4563c', 'schemes');
module.exports = built;
