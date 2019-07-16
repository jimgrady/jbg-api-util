# JBG API Utilities

The goal of this module is to make it fast and easy to roll out json-rest apis. The module itself is written in node.js but it supports transparently calling other http apis that can of course be written in any language.

The basic idea is that when writing your own api code, you don't have to think about how it will be called. Your only job is to take in a parameters object and return a result object. And when calling other apis, you don't have to think about where they are - you just call them by name and they will be called either locally or remotely as needed based on config.

The likely scenario is that the apis will be running under the express framework, but again when writing code you don't need to think about that. The sbt-api-util module itself doesn't run an http server, it just gets specified in an api server's package.json and pulled in as an npm module. (All of this assumes you have nodejs and npm installed locally)

Important: there's no security or authentication built into this yet, it will be easy enough to add, but for now don't use this for any information you wouldn't want to potentially become public.

For example, the https://github.com/StopBreatheThink/sbt-bot-slack app is a simple wrapper that takes in slack webhook requests (as posts with a url-encoded body) and calls the sbt-bot-main api to get a response. The heart of it is an Api class at api/slack.js. Here's that class with some extra comments.

`
"use strict"

//cleanest to use ecmascript 6 classes (supported by newest nodejs)
//but as long as you end up exporting an object that has get, post, put, or delete methods,
//it doesn't matter how you do it
class Api {
    constructor(options) {
        //the apiClient gets injected as part of the options object
        //hold onto a reference to it if you're going to need to call any other apis
        this.apiClient = options.apiClient;
        //nothing special about this object, just a simple convention for error messages
        this.messages = {
            textMissing: "required parameter 'text' missing"
        }
    }

    //implement methods get, post, put, delete, and they will be called based on http request method
    get(params) {
        //for easier testing - slack will use POST
        return this.post(params);
    }

    //here's the main functionality - params will end up as an object whether they're passed
    //locally or via http in a json body, url-encoded post body, or querystring
    post(params) {
        //hang onto a reference to the current object, it will get overwritten in some contexts
        var self = this;
        
        //define internal functions to break up the logic into steps
        function validateInput(input) {
            //always use promise objects, so that these can easily be called in an asynchronous context
            return new Promise(function(resolve, reject) {
                if (!input.text) {
                    //call "reject" to fail - return an object with status and message keys
                    //if we are in an http context, this will get turned into the http status code
                    reject({status: 400, message: self.messages.textMissing});
                }
                //call "resolve" to succeed - this output will be passed along to the next processing
                //phase, or returned as needed
                resolve({text: input.text});
            });
        }

        function getMainBotResponse(input) {
            //never call other api modules directly, always use the apiClient that was injected
            //in options upon construction - this way the api you're calling could be local or remote
            //and it will work the same either way
            return self.apiClient.call({
                //key used when setting up configuration - see server.js below
                endpoint: "messages",
                //modify the input to the called api here
                params: input,
                //modify the output from the called api here
                //see below for more detailed description of return format
                parser: function(data) { return {_raw: data} }
            });
            //the apiClient already returns a promise object,
            //so you don't have to wrap it in another one
        }

        //here's the main flow - because of the use of promise objects, what could otherwise
        //be a complicated set of callbacks can look simple and procedural
        
        //always return a promise
        return new Promise(function(resolve, reject) {
            //call your sub-functions in order, using "then" to proceed in case of success
            validateInput(params)
                .then(getMainBotResponse)
                //your last "then" should always resolve the promise
                .then(resolve)
                //this calls the reject/error callback if any of your subfunctions errored
                .catch(reject);
        });

    }
}

module.exports = Api;
`

That's the heart of what you're writing. The rest is housekeeping/configuration to make your own api available, and to say from where you want to call any other apis you need.

When creating an api, you need to add this sbt-api-util package to your dependencies, as well as some means of serving http requests, for example the express framework. Here's the package.json from sbt-bot-slack:

`
{
  "name": "sbt-bot-slack",
  "main": "server.js",
  "description": "Stop, Breathe & Think Slack messaging bot wrapper",
  "version": "0.0.0",
  "license": "TODO",
  "repository": "git@github.com:StopBreatheThink/sbt-bot-slack.git",
  "dependencies": {
    "sbt-api-util": "https://sbt-automation:be3cd380457279e07c05bf419bd2127a597ec1b5@github.com/StopBreatheThink/sbt-api-util.git#master",
    "express": "~4.0.0"
  }
}
`

Note that sbt-api-util is not a published node module, so we have to specify it in a github repo. Our dummy user sbt-automation has to be given access to any github repos you want to use in this way.

By putting that in your package.json, when you then run
`npm install`
the latest will get pulled in.

Now you need to create instances of the client and server utilities, and attach them to your framework's routes. Again here's the example server from sbt-bot-slack, with some extra comments:

`
"use strict"

var express = require('express');
var path = require('path');
var apiUtil = require('sbt-api-util');

var app = express();
//pick whatever port you want but it's helpful to have something that other api microservices
//don't use, so that you can run multiple microservices on your local machine if you want
var port = process.env.PORT || 4200;

//this is the heart of your api configuration - client code will call these apis
//using their keys e.g. (slack, messages)
var endpoints = {
    //this says that the "slack" api endpoint is local, it should call the api/slack.js code we saw above
    slack: require('./api/slack.js'),
    //this says that the "messages" api endpoint is remote, it should be called over https
    messages: 'https://sbt-bot-main.herokuapp.com/api/messages'
};

//create an instance of the api client class, and configure it with the endpoints we just defined
var apiClientInstance = new apiUtil.client({
        endpoints: endpoints
    });

//create an instance of the server api endpoint
var apiServerInstance = new apiUtil.server({
    //ok we are a bit tightly coupled to express here, to be fixed
    app: app,
    router: express.Router(),
    //provide an instance of the api client we just created
    //this way if an api we're serving needs to call another api, it can find it.
    apiClient: apiClientInstance,
    //pass in the same map of endpoints as before
    endpoints: endpoints
});

//our convention is to mount the api endpoints under /api
//this means that the "slack" endpoint defined in the endpoints object can be reached at:
// /api/slack
app.use(
    '/api/*',
    apiServerInstance.routes(apiServerInstance)
);

//if you want you can put stuff in /public like a favicon.ico to avoid 404s
app.use(express.static(path.join(__dirname, 'public')));
app.listen(port);
console.log('listening on port ' + port);
`

To run that locally, let's say you called your server file server.js, you can use:
`node server.js`

To make it run on heroku, just add a file called Procfile heroku to run that when starting a web dyno, e.g.:
`web: node server.js`


To go through the flow for sbt-bot-slack:
1. slack calls https://sbt-bot-slack.herokuapp.com/api/slack (because we entered that into slack's bot configuration).
2. because it was specified in the Procfile, heroku sends the request to e.g. server.js
2. Inside server.js, the express framework passes the request into sbt-api-util's lib/server.js, which uses the endpoints object to map "slack" to api/slack.js.
3. lib/server.js makes an instance of the class at api/slack.js, and passes it the params from the request (in this case a url-encoded post but the slack.js code doesn't know or care).
4. The Api class in api/slack.js uses the apiClientInstance (whose code is in lib/client.js) to call the messages api endpoint.
5. lib/client.js sees from the endpoints object that messages is a remote endpoint, so it calls it via https
6. lib/client.js returns the result to api/slack.js, which
7. formats it in a way that Slack can understand, and
8. passes it back to lib/server.js, which
9. passes the response to Slack via https.


The way the normal development process might go:
1. Set up your package.json with express and sbt-api-util dependencies
2. Create a server.js with the boilerplate express app code above, setting the port to e.g. 4300
3. For each api endpoint you want to make,
    a. create a class like the api/slack.js example above, say it's named the-endpoint.js
    b. add it to the endpoints object in your server.js like "the-endpoint": require('./api/the-endpoint.js) (or wherever you put it)
4. Start your server with node index.js. You can then hit your endpoint(s) at e.g. localhost:4300/api/the-endpoint
5. When they're working well, create a heroku app and a Procfile with `web: node server.js` and push your code up. You should then be able to hit it at your-app-name.herokuapp.com/api/the-endpoint etc.
6. If you decide you want to split out your endpoints into different microservice codebases, just make a new heroku app, copy over your server.js, package.json, and api/someendpoint.js, and modify the package name and port and endpoints config, and you're up and running
7. If someone else makes a great version of a particular api service, e.g. some awesome natural language processor that you want to use instead of yours, just change your endpoints object to point to it.

For that last part to work - the part about being able to call apis over http in any language, we need some quick conventions on how data is returned. Our conventions are:

We always expect to receive and return input in either querystring params or in the json body, and return them as json.
The exception is when writing the connector to an external api, we need to receive and return in a format it supports.
If parameters are sent as a url-encoded body like a traditional post, we'll understand them, as long as the correct Content-Type is set.
(TODO: we need to support path params like /api/theendpoint/some-id-here but for now we only have /api/theendpoint?id=some-id-here etc.)

We expect to receive data as a json object (or its url-encoded equivalent), e.g. the data sent to a post to /api/cars would look like:

`
{
    "make": "Ford",
    "model": "Fiesta",
    "year": 1999
}`

When we return a single resource, we'll return a status 200 code, and by default we'll wrap it as follows:
`
{
    "data": {
        "make": "Ford",
        "model": "Fiesta",
        "year": 1999
    }
}
`

When we return multiple resources, they'd look like:

`
{
    "data": [
        {
            "make": "Ford",
            "model": "Fiesta",
            "year": 1999
        },
        {
            "make": "Ford",
            "model": "Tempo",
            "year": 2000
        }
    ]
}
`

We put stuff under a "data" key so that we have room to support metadata in the future, such as page and number per page, etc.

In case of an error, we'll return the most meaningful status code both in the http response header, and in the json response like:

`
{
    "error": {
        "status": 404,
        "message": "crappy old car not found"
    }
}`

From the point of view of your api class, just return the data object itself. So the object I would pass into the final
"resolve" call in my api would just be the car object, and the system would wrap it inside "data" for you. If you want
to take more control of the output format (normally you shouldn't for consistency but just in case), pass back an object
which itself contains a "data" key, and lib/server.js will assume you've already wrapped in the way you want to.

If you need to pass back data to an external service, such as in the slack.js example above, and therefore it needs not
to be wrapped inside a "data" key, pass it back like this:

`
{
    _raw: {
        text: "hi there"
    }
}`

This tells lib/server.js not to wrap the response, so it will come back as:

`
{
    "text": "hi there"
}`

This means that "data" and "_raw" are reserved top-level keys in this system, so don't use them in your own result objects.

A few final notes:

If you need to troubleshoot a couple of different microservices talking to each other, pull them down and run them
on your local machine (on different ports), and set their endpoints config objects to e.g. http://localhost:4xxx/api/something
instead of herokuapp. Even better, use something like Charles proxy to watch requests going back and forth.
Another option is to grab the api/something.js code from one microservice and drop it temporarily into your api/something.js
and then set its key in the endpoints object to require('./api/something.js') so you can have it running under a single server.

If you want to work on the code in sbt-api-util itself, without pushing it up to git every time, do this:
`
cd path/to/sbt-api-util
npm link
cd ../path/to/your-microservice-foo
npm link sbt-api-util
`
Now if you make a change to your local sbt-api-util, it will be picked up when you run your your-microservice-foo
(you can see that it essentially just made a symlink)

