var _             = require('lodash');
var assert        = require('assert');
var childProcess  = require('child_process');
var Promise       = require('promise');
var debug         = require('debug')('base:LocalApp');
var events        = require('events');
var util          = require('util');
var base          = require('./');
var fs            = require('fs');
var path          = require('path');


/**
 * Start an executable that uses the express configuration from from `base.app`
 * to launch an express server and listen for requests.
 *
 * options:
 * {
 *   command:          // Script to execute (with node.js)
 *   args:             // Arguments to pass to subprocess
 *   cwd:              // Current working folder for the subprocess
 *   name:             // Name used for logging
 *   baseUrlPath:      // Path to add after http://localhost:<port>
 * }
 *
 * Note, `LocalApp` is only useful for testing executables that runs an express
 * application as configured in `base.app`. As we rely on a IPC message from
 * the child process to tell us which PORT it's listening on and to know when
 * the child process is ready and listening for requests.
 */
var LocalApp = function(options) {
  events.EventEmitter.call(this);
  this.options = _.defaults(options, {
    command:        undefined,
    args:           [],
    cwd:            process.cwd(),
    name:           'LocalApp',
    baseUrlPath:    '/'
  });
  assert(options.command, "Command must be given");
  this.onEarlyExit = this.onEarlyExit.bind(this);
};

// Inherit from events.EventEmitter
util.inherits(LocalApp, events.EventEmitter);

/**
 * Launch the command in a subprocess, return a promise with the baseUrl for the
 * server when it listening.
 */
LocalApp.prototype.launch = function() {
  var that = this;
  return new Promise(function(accept, reject) {
    // Create subprocess
    that.process = childProcess.fork(that.options.command, that.options.args, {
      env:      process.env,
      silent:   false,
      cwd:      that.options.cwd
    });

    // Reject on exit
    that.process.once('exit', reject);

    // Message handler
    var messageHandler = function(message) {
      if (!message.ready) return;

      // Stop listening messages
      that.process.removeListener('message', messageHandler);

      // Stop listening for rejection
      that.process.removeListener('exit', reject);

      // Listen for early exits, these are bad
      that.process.once('exit', that.onEarlyExit);

      // Accept that the server started correctly
      debug("----------- LocalQueue Running --------------", that.options.name);
      accept('http://localhost:' + message.port + that.options.baseUrlPath);
    };

    // Listen for the started message
    that.process.on('message', messageHandler);
  });
};

/** Handle early exits */
LocalApp.prototype.onEarlyExit = function() {
  debug("----------- %s Crashed --------------", this.options.name);
  this.emit('error', new Error(this.options.name + " process exited early"));
};

/** Terminate local app instance */
LocalApp.prototype.terminate = function() {
  var that = this;
  return (new Promise(function(accept) {
    if (!that.process) {
      return accept();
    }
    that.process.removeListener('exit', that.onEarlyExit);
    that.process.once('exit', accept);
    that.process.kill();
    that.process = null;
  })).then(function() {
    debug("----------- %s Terminated -----------", that.options.name);
  });
};


// Export LocalApp
exports.LocalApp = LocalApp;

/**
 * Test schemas with a positive and negative test cases. This will run call
 * `setuo` and `test` which is assumed to exist in global scope.
 * Basically, it only makes sense to use from inside `suite` in a mocha test.
 *
 * options:{
 *   validator: {}  // options for base.validator
 *   cases: [
 *     {
 *       schema:    'http://...'      // JSON schema identifier to test against
 *       path:      'test-file.json', // Path to test file
 *       success:   true || false     // Is test expected to fail
 *     }
 *   ],
 *   basePath:      path.join(__dirname, 'validate')  // basePath test cases
 * }
 */
var schemas = function(options) {
  assert(options.validator, "Options must be given for validator");
  assert(options.cases instanceof Array, "Array of cases must be given");

  var validator = null;
  setup(function() {
    return base.validator(options.validator).then(function(validator_) {
      validator = validator_;
    });
  });

  options.cases.forEach(function(testCase) {
    test(testCase.path, function() {
      // Load test data
      var filePath = testCase.path;
      // Prefix with basePath if a basePath is given
      if (options.basePath) {
        filePath = path.join(options.basePath, filePath);
      }
      var data = fs.readFileSync(filePath, {encoding: 'utf-8'});
      var json = JSON.parse(data);

      // Validate json
      var errors = validator.check(json, testCase.schema);

      // Test errors
      if(testCase.success) {
        if (errors !== null) {
          debug("Errors: %j", errors);
        }
        assert(errors === null,
               "Schema doesn't match test for " + testCase.path);
      } else {
        assert(errors !== null,
               "Schema matches unexpectedly test for " + testCase.path);
      }
    });
  });
};

// Export schemas
exports.schemas = schemas;