'use strict';

let MQTT = require('./MQTT');
let huejay = require('huejay');
let Promise = require("bluebird");
let hue;
let mqtt;

const DEFAULT_CONFIG = {
    hue: {
        host:       undefined,
        port:       80,
        username:   undefined,
        timeout:    15000
    },
    mqtt: {
        url:        undefined,
        baseTopic:  'device/hue-bridge',
        clientId:   'hue-bridge'
    }
};

/**
 * TODO: let the software part hold a light state and assure update based on MQTT triggers and HUE Bridge
 * TODO: automaticaly assign new Scenes
 * TODO: send HTTP request async if we have more then one, keep track of hue bridge max http connections
 */
class HueBridge {

    /**
     * Constructor
     *
     * @param {Object} config Configuration
     */
    constructor(config) {
        this.config    = {
            hue: Object.assign({}, DEFAULT_CONFIG.hue, config.hue),
            mqtt: Object.assign({}, DEFAULT_CONFIG.mqtt, config.mqtt)
        };
        hue = new huejay.Client(config.hue);
        this.lights = [];
        this.groups = [];
        this.queue = null;
    }

    /**
     * run
     *
     * @returns {Promise<*>}
     */
    async run() {
        try {
            mqtt = await MQTT.getClient(this.config.mqtt);
            await mqtt.subscribe(`${this.config.mqtt.baseTopic}/light/+/set`);
            await mqtt.subscribe(`${this.config.mqtt.baseTopic}/group/+/set`);
            mqtt.on('message', this.handleMessage.bind(this));
            return await this.poll();
        } catch (error) {
            console.log(`An error occurred: ${error.message}\n${error.stack}`);
        }
    }

    /**
     * handle a MQTT message
     *
     * @param topic
     * @param message
     */
    handleMessage(topic, message) {
        if (topic.indexOf(`${this.config.mqtt.baseTopic}/light/`) === 0) {
            if (this.queue) {
                this.queue.then(() => {
                    return this.handleLightSet(topic, message);
                });
            } else {
                this.queue = Promise.all([this.handleLightSet(topic, message)]).finally(() => {
                    this.queue = null;
                });
            }
        } else if (topic.indexOf(`${this.config.mqtt.baseTopic}/group/`) === 0) {
            if (this.queue) {
                this.queue.then(() => {
                    return this.handleGroupSet(topic, message);
                });
            } else {
                this.queue = Promise.all([this.handleGroupSet(topic, message)]).finally(() => {
                    this.queue = null;
                });
            }
        }
    }

    /**
     * handle light set by MQTT
     *
     * @param topic
     * @param message
     * @returns {Promise<any>}
     */
    handleLightSet(topic, message) {
        let data = {
            id: parseInt(topic.replace(`${this.config.mqtt.baseTopic}/light/`, '').replace('/set', '')),
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
            this.handleLightState(light);
        }).catch(error => {
            console.log(`An error occurred: ${error.message}\n${error.stack}`);
        });
    }

    /**
     * handle group set by MQTT
     *
     * @param topic
     * @param message
     * @returns {Promise<any>}
     */
    handleGroupSet(topic, message) {
        let data = {
            id: parseInt(topic.replace(`${this.config.mqtt.baseTopic}/group/`, '').replace('/set', '')),
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
            this.handleGroupState(group);
        }).catch(error => {
            console.log(`An error occurred: ${error.message}\n${error.stack}`);
        });
    }

    /**
     * poll the hue bridge for state changes
     *
     * @returns {Promise<void>}
     */
    async poll() {
        return await Promise.resolve().then(() => {
            hue.lights.getAll().then(lights => {
                for (let light of lights) {
                    this.handleLightState(light);
                }
            });
            hue.groups.getAll().then(groups => {
                for (let group of groups) {
                    this.handleGroupState(group);
                }
            });
            return Promise.delay(1000).then(this.poll.bind(this));
        });
    }

    /**
     * publish to MQTT
     *
     * @param topic
     * @param msg
     * @param options
     * @returns {Promise<*>}
     */
    async publish(topic, msg, options) {
        try {
            return await mqtt.publish(topic, msg, options);
        } catch(error) {
            console.log(`An error occurred: ${error.message}\n${error.stack}`);
        }
    }

    /**
     * handle possible light state change
     *
     * @param light
     * @returns {*}
     */
    handleLightState(light) {
        if (!this.lights[light.id]) {
            this.lights[light.id] = light;
            return this.publishLight(light);
        }
        for (let attribute in light.state.attributes) {
            if (light.state.attributes[attribute] === this.lights[light.id].state.attributes[attribute]) {
                continue;
            }
            this.lights[light.id] = light;
            return this.publishLight(light);
        }
    }

    /**
     * publish the new light state to MQTT
     *
     * @param light
     * @returns {Promise<*>}
     */
    publishLight(light) {
        light.state.attributes.time = new Date().getTime();
        return this.publish(this.config.mqtt.baseTopic + '/light/' + light.id,
            JSON.stringify(Object.assign(light.state.attributes, light.attributes.attributes)), {
            qos:2,
            retain: true
        });
    }

    /**
     * handle possible group state change
     *
     * @param group
     * @returns {*}
     */
    handleGroupState(group) {
        if (!this.groups[group.id]) {
            this.groups[group.id] = group;
            return this.publishGroup(group);
        }
        for (let attribute in group.state.attributes) {
            if (group.state.attributes[attribute] === this.groups[group.id].state.attributes[attribute]) {
                continue;
            }
            this.groups[group.id] = group;
            return this.publishGroup(group);
        }
    }

    /**
     * publish group changes to MQTT
     *
     * @param group
     * @returns {Promise<*>}
     */
    publishGroup(group) {
        group.state.attributes.time = new Date().getTime();
        return this.publish(this.config.mqtt.baseTopic + '/group/' + group.name.replace(' ', '_').toLowerCase(),
            JSON.stringify(Object.assign(group.state.attributes, group.attributes.attributes)),
            { qos:2, retain: true }
        );
    }

}

module.exports = HueBridge;