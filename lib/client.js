"use strict"

var restClient = require('node-rest-client').Client;

class Client {
    constructor(options) {
        this.endpoints = options.endpoints;
        this.endpointInstances = {};
        this.client = new restClient();
    }

    loadClientOptions(callOptions, reject) {
        var clientOptions = {headers:{}};
        if (callOptions['Content-Type']) {
            clientOptions.headers['Content-Type'] = callOptions['Content-Type'];
            delete callOptions['Content-Type'];
        } else {
            clientOptions.headers['Content-Type'] = 'application/json';
        }
        callOptions.parser = callOptions.parser || function (data) { return data };
        this.loadRequestMethod(callOptions, clientOptions, reject);
        return clientOptions;
    }

    loadRequestMethod(callOptions, clientOptions, reject) {
        clientOptions.method = callOptions.method || 'get';
        switch (clientOptions.method) {
            //TODO: path params
            case 'get':
            case 'delete':
                clientOptions.parameters = callOptions.params;
                break;
            case 'put':
            case 'post':
                clientOptions.data = callOptions.params;
                break;
            default:
                reject({status: 405, message: 'method not supported'});
        }
    }

    callRemote(endpoint, callOptions) {
        var self = this;

        return new Promise(function (resolve, reject) {
            var clientOptions = self.loadClientOptions(callOptions, reject);
            var req = self.client[clientOptions.method](
                self.endpoints[callOptions.endpoint],
                clientOptions,
                function (data, response) {
                    let returnToParser = data.data ? data.data : data
                    resolve(callOptions.parser(returnToParser));
                }
            );
            req.on('error', function (err) {
                reject({status: 500, message: err})
            });
        });
    }

    callLocal(endpoint, callOptions) {
        var self = this;
        callOptions.method = callOptions.method || 'get';
        callOptions.parser = callOptions.parser || function (data) { return data };
        if (!this.endpointInstances[callOptions.endpoint]) {
            this.endpointInstances[callOptions.endpoint] = new endpoint({apiClient: self});
        }
        return new Promise(function(resolve, reject) {
            self.endpointInstances[callOptions.endpoint][callOptions.method](callOptions.params)
                .then(function(result) {
                    resolve(callOptions.parser(result));
                })
                .catch(reject)
        });
    }

    call(callOptions) {
        var endpoint = this.endpoints[callOptions.endpoint];
        if (typeof endpoint == 'string') {
            return this.callRemote(endpoint, callOptions);
        } else {
            return this.callLocal(endpoint, callOptions);
        }


    }
}

module.exports = Client;