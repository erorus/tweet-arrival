const FlightAware = require('flightaware.js'),
    fs = require('fs'),
    crypto = require('crypto');

const CACHE_PATH = __dirname + '/flightaware-cache/';

var CachedFunctions = [
    'AircraftType',
    'AirlineInfo',
];

function FlightAware_Cached(username,apiKey) {
    this.username = username;
    this.apiKey = apiKey;

    this.fa = new FlightAware(this.username, this.apiKey);

    for (var k in FlightAware.prototype) {
        if (!FlightAware.prototype.hasOwnProperty(k)) {
            continue;
        }
        if (typeof FlightAware.prototype[k] != 'function') {
            continue;
        }
        if (FlightAware_Cached.prototype.hasOwnProperty(k)) {
            continue;
        }

        this[k] = FlightAware.prototype[k].bind(this.fa);
    }
}

function MakeCachedFunction(functionName) {
    return function()
    {
        var args = Array.from(arguments);
        var realCallback = args.pop();

        var hash = crypto.createHash('sha256');
        var argString = JSON.stringify(args);
        var argHash = hash.update(argString).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        var cachedResultPath = CACHE_PATH + functionName + '.' + argHash + '.json';

        var fa = this.fa;

        fs.readFile(cachedResultPath, function(err, data)
        {
            if (err) {
                if (err.code === 'ENOENT') {
                    args.push(
                        function (err, result)
                        {
                            if (!err) {
                                fs.writeFile(cachedResultPath, JSON.stringify(result));
                            }

                            realCallback(err, result);
                        }
                    );

                    fa[functionName].apply(fa, args);
                    return;
                }

                realCallback(err, null);
            }

            if (!data) {
                data = '{}';
            }

            var json = JSON.parse(data);
            realCallback(null, json);
        });
    }
}

var f;
while (f = CachedFunctions.pop()) {
    FlightAware_Cached.prototype[f] = MakeCachedFunction(f);
}

module.exports = FlightAware_Cached;

