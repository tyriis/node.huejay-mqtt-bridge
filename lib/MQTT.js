'use strict';

let Client = require('async-mqtt');


module.exports = {
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
            return await client;
        } catch (error) {
            console.log(`An error occurred: ${error.message}\n${error.stack}`);
        }
    }
};