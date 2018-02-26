'use strict';

let Client = require('async-mqtt');


module.exports = {
    /**
     * return a MQTT Client Object based on config
     * with last will to {config.baseTopic}/status {payload: 0}
     * auto publish every 60 sec to {config.baseTopic}/status {payload: 1} while active
     * @param config
     * @returns {Promise<*>}
     */
    async getClient(config) {
        try {
            let client =  Client.connect(config.url, {
                clientId: config.clientId,
                clean: false,
                will: {
                    topic: config.baseTopic + '/status',
                    payload: '0',
                    qos: 2,
                    retain: true
                }
            });
            client.on("connect", () => {
                client.publish(config.baseTopic + '/status', '1', {qos: 2, retain: true});
            });
            setInterval(() => {
                client.publish(config.baseTopic + '/status', '1', {qos: 2, retain: true});
            }, 60 * 1000);
            return await client;
        } catch (error) {
            console.log(`An error occurred: ${error.message}\n${error.stack}`);
        }
    }
};