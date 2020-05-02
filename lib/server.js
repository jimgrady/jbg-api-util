"use strict"

var path = require('path');
var bodyParser = require('body-parser');
var rawBodySaver = function (req, res, buf, encoding) {
    if (buf && buf.length) {
        req.rawBody = buf.toString(encoding || 'utf8');
    }
}

class Server {
    constructor(options, instanceConfig) {
        this.app = options.app;
        this.app.use(bodyParser.urlencoded({ extended: false }));
        if (options.useRawBody) {
            this.app.use(bodyParser.json({
                verify: rawBodySaver, type: function () {
                    return true
                }
            }));
        } else {
            this.app.use(bodyParser.json());
        }
        this.router = options.router;
        this.log = options.log;
        this.includeRequestId = options.includeRequestId;

        this.endpoints = options.endpoints;
        this.instanceConfig = instanceConfig || {};
        this.instanceConfig.apiClient = options.apiClient;
        this.endpointInstances = {};
        this.headerParams = options.headerParams || [];
    }

    respondWithError(res, e) {
        console.log("ERROR", e);
        res.status(e.status).json({error: {code: e.status, message: e.message}});
        res.end();
    }

    respondWithSuccess(response, result) {
        var out = {};
        if (result.hasOwnProperty('_raw')) {
            out = result._raw;
        } else if (result.hasOwnProperty('_redirect')) {
            response.redirect(result._redirect);
            return;
        } else if (result.hasOwnProperty('data')) {
            out = result;
        } else {
            out = {data: result};
        }
        response.json(out);
    }

    extractParams(method, req) {
        //TODO: different parsing for different methods
        var key, params = req.body, authParts;
        for (key in req.query) {
            params[key] = req.query[key];
        }
        if (req.rawBody) {
            params._body = req.rawBody;
        }
        if (req.header('Authorization') && (
            req.header('Authorization').indexOf('Bearer ') == 0
            || req.header('Authorization').indexOf('bearer ') == 0
        )
        ) {
            authParts = req.header('Authorization').split(/\s/);
            params["_auth_token"] = authParts[1];
        }
        if (this.includeRequestId && req.header('X-Request-ID')) {
            params['_request_id'] = req.header('X-Request-ID');
        }
        this.headerParams.forEach(header =>{
            params[header] = req.header(header);
        });
        return params;
    }

    getEndpoint(path) {
        if (!this.endpointInstances[path]) {
            this.endpointInstances[path] = new this.endpoints[path](this.instanceConfig);
            this.endpointInstances[path].log = this.log;
        }
        return this.endpointInstances[path];
    }

    processEndpoint(path, method, req, res) {
        var self = this;
        var endpoint = self.getEndpoint(path);
        if (!endpoint[method]) {
            return self.respondWithError(res, {status: 405, message: 'method not available'});
        }
        return endpoint[method](self.extractParams(method, req), {originalUrl: req.originalUrl, baseUrl: req.baseUrl})
            .then(function(result) {
                self.respondWithSuccess(res, result);
            })
            .catch(function(e) {
                self.respondWithError(res, e);
            });
    }

    processMethod(method, req, res) {
        var self = this;
        var matches = req.originalUrl.match(/\/api\/([^?]*)/); //TODO: find the more express-native way to do this
        var apiUrl = matches[1];
        var segments = apiUrl.split(path.sep), checkPath;
        while (segments.length > 0) {
            checkPath = segments.join(path.sep);
            if (self.endpoints[checkPath]) {
                return self.processEndpoint(checkPath, method, req, res);
            }
            segments.pop();
        }
        self.respondWithError(res, {status: 404, message: 'api endpoint not found'});
    }

    routes(self) {
        var self = this; //protect from overwrite of "this" by express
        self.router.get('*', function(req, res, next) {
            self.processMethod('get', req, res);
        });
        this.router.post('*', function(req, res, next) {
            self.processMethod('post', req, res);
        });
        this.router.put('*', function(req, res, next) {
            self.processMethod('put', req, res);
        });
        this.router.delete('*', function(req, res, next) {
            self.processMethod('delete', req, res);
        });
        return self.router;
    }
}

module.exports = Server;