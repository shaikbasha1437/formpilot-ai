const fs = require('fs'); const path = require('path');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));
const TODAY = new Date(2026, 10, 11); // Wed Nov 11 2026, same day the fixtures were captured
module.exports = { fixture, TODAY };
