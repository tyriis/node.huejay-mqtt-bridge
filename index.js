let HueBridge = require('./lib/HueBridge');
let config = require('./config.json');

let bridge = new HueBridge(config);
bridge.run()