let huejay = require('huejay');
let MQTT = require("async-mqtt");
let Promise = require("bluebird");

let host = '192.168.1.151';
let hue;
let mqtt;
let username = 'Kyh3N-uR363SRVb2bzMaH7eNzDOtEcyhWy5v5sM0';
let baseTopic = 'device/hue-bridge';
let queue;

let colorTemps = {
    'konzentrieren': 233,
    'lesen': 346,
    'energie': 156,
    'entspannen': 447 // bri 144
};

async function publish(topic, msg, options) {
    try {
        return await mqtt.publish(topic, msg, options);
    } catch(error) {
        console.log(`An error occurred: ${error.message}\n${error.stack}`);
    }
}

async function getHueClient() {
    try {
        if (host) {
            return new huejay.Client({
                host:     host,
                port:     80,
                username: username,
                timeout:  15000
            });
        }
        return await huejay.discover().then(bridges => {
            return new huejay.Client({
                host:     bridges[0].ip,
                port:     80,
                username: username,
                timeout:  15000
            });
        }).catch(error => {
            console.log(`An error occurred: ${error.message}\n${error.stack}`);
        });
    } catch (error) {
        console.log(`An error occurred: ${error.message}\n${error.stack}`);
    }
}

async function getMQTTClient() {
    try {
        let client =  MQTT.connect("tcp://mqtt.lan:1883", {
            clientId: 'huejay-mqtt-bridge',
            clean: false,
            will: {
                topic: baseTopic + '/status',
                payload: '0',
                qos: 2,
                retain: true
            }
        });
        client.on("connect", () => {
            client.publish(baseTopic + '/status', '1', {qos: 2, retain: true});
        });
        return await client;
    } catch (error) {
        console.log(`An error occurred: ${error.message}\n${error.stack}`);
    }
}

let handleLightSet = (topic, message) => {
    let data = {
        id: parseInt(topic.replace(`${baseTopic}/light/`, '').replace('/set', '')),
        topic: topic,
        raw: message,
        message: JSON.parse(message)
    };
    return hue.lights.getById(data.id).then(light => {
        if (light) {
            for (let attribute in data.message) {
                light[attribute] = data.message[attribute];
            }
            return hue.lights.save(light);
        }
    }).then(light => {
        handleLightState(light);
    });
};

let handleGroupSet = (topic, message) => {
    let data = {
        id: parseInt(topic.replace(`${baseTopic}/group/`, '').replace('/set', '')),
        topic: topic,
        raw: message,
        message: JSON.parse(message)
    };
    return hue.groups.getById(data.id).then(group => {
        if (group) {
            for (let attribute in data.message) {
                group[attribute] = data.message[attribute];
            }
            return hue.groups.save(group);
        }
    }).then(group => {
        handleGroupState(group);
    });
};

let handleMessage = (topic, message) => {
    if (topic.indexOf(`${baseTopic}/light/`) === 0) {
        if (queue) {
            queue.then(() => {
                return handleLightSet(topic, message);
            });
        } else {
            queue = Promise.all([handleLightSet(topic, message)]).finally(() => {
                queue = null;
            });
        }
    } else if (topic.indexOf(`${baseTopic}/group/`) === 0) {
        if (queue) {
            queue.then(() => {
                return handleGroupSet(topic, message);
            });
        } else {
            queue = Promise.all([handleGroupSet(topic, message)]).finally(() => {
                queue = null;
            });
        }
    }
};

async function run() {
    try {
        mqtt = await getMQTTClient();
        hue = await getHueClient();
        await mqtt.subscribe(`${baseTopic}/light/+/set`);
        await mqtt.subscribe(`${baseTopic}/group/+/set`);
        mqtt.on('message', handleMessage);
        return await poll();
    } catch (error) {
        console.log(`An error occurred: ${error.message}\n${error.stack}`);
    }
}

let publishLight = (light) => {
    light.state.attributes.time = new Date().getTime();
    return publish(baseTopic + '/light/' + light.id, JSON.stringify(Object.assign(light.state.attributes, light.attributes.attributes)), {
        qos:2,
        retain: true
    });
};

let lights = [];

let handleLightState = (light) => {
    if (!lights[light.id]) {
        lights[light.id] = light;
        return publishLight(light);
    }
    for (let attribute in light.state.attributes) {
        if (light.state.attributes[attribute] === lights[light.id].state.attributes[attribute]) {
            continue;
        }
        lights[light.id] = light;
        return publishLight(light);
    }
};

let groups = [];

let publishGroup = (group) => {
    group.state.attributes.time = new Date().getTime();
    return publish(baseTopic + '/group/' + group.name.replace(' ', '_').toLowerCase(),
        JSON.stringify(Object.assign(group.state.attributes, group.attributes.attributes)),
        { qos:2, retain: true }
    );
};

let handleGroupState = (group) => {
    if (!groups[group.id]) {
        groups[group.id] = group;
        return publishGroup(group);
    }
    for (let attribute in group.state.attributes) {
        if (group.state.attributes[attribute] === groups[group.id].state.attributes[attribute]) {
            continue;
        }
        groups[group.id] = group;
        return publishGroup(group);
    }
};

async function poll() {
    return await Promise.resolve().then(function() {
        hue.lights.getAll().then(lights => {
            for (let light of lights) {
                handleLightState(light);
            }
        });
        hue.groups.getAll().then(groups => {
            for (let group of groups) {
                handleGroupState(group);
            }
        });
        return Promise.delay(1000).then(poll);
    });
}

run();
