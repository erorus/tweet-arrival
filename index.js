const fa = new (require('./flightaware-cached'))(process.env.FLIGHTAWARE_USER, process.env.FLIGHTAWARE_KEY),
    aircraftImage = require('./aircraft-image'),
    async = require('async'),
    http = require('http'),
    https = require('https'),
    Twitter = require('twitter');

var twitter = !process.env.TWITTER_CONSUMER_KEY ? false : new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

process.on('exit', function(err) {
    console.log('Exiting!');
});

//typeImageTest();
//typeInfoTest();

if (process.argv[2]) {
    ProcessICAO(process.argv[2]);
} else if (process.env.HTTP_SERVER_PORT) {
    var httpServer = http.createServer(ServerCallback);
    httpServer.listen(process.env.HTTP_SERVER_PORT, process.env.HTTP_SERVER_HOST);
    console.log('listening at ' + process.env.HTTP_SERVER_HOST + ':' + process.env.HTTP_SERVER_PORT);
}

function ServerCallback(req, res) {
    var m;
    if (m = req.url.match(/^\/([a-f0-9]{6})$/)) {
        return ProcessICAO(m[1], res);
    }
    res.writeHead(404, 'Not Found');
    res.end();
}

function EndWithResponse(flight, message) {
    console.log(message);
    if (flight.httpResponse) {
        flight.httpResponse.setHeader('Content-Type', 'text/plain; charset=utf-8');
        flight.httpResponse.end(message, 'utf8');
    }
}

function ProcessICAO(icao, httpResponse)
{
    var flight = {
        icao: icao.toLowerCase()
    };

    if (httpResponse) {
        flight.httpResponse = httpResponse;
    }

    var req = http.request({
            hostname: 'flightaware.com',
            path: '/live/modes/' + icao.toLowerCase() + '/redirect',
            method: 'HEAD'
        }, function (res) {
            res.resume();
            if (!res.headers || !res.headers.location) {
                return EndWithResponse(flight, 'error fetching redirect for icao ' + icao);
            }

            var m;
            if (!(m = res.headers.location.match(/^https?:\/\/flightaware\.com\/live\/flight\/([^\/]+)\/history\/(\d{8})\/(\d{3,4})Z\//))) {
                return EndWithResponse(flight, 'icao ' + icao + ' redirected to unknown format: ' + res.headers.location);
            }

            flight.ident = m[1];
            flight.departureStrings = {
                date: m[2],
                time: m[3]
            };

            ProcessFlightByDepartureStrings(flight);
        }
    );
    req.end();
}

function ProcessFlightByDepartureStrings(flight)
{
    if (flight.departureStrings.time.length < 4) {
        flight.departureStrings.time = '0'.repeat(4 - flight.departureStrings.time.length) + flight.departureStrings.time;
    }

    flight.departureTime = Date.UTC(
            parseInt(flight.departureStrings.date.substr(0, 4), 10),
            parseInt(flight.departureStrings.date.substr(4, 2), 10) - 1,
            parseInt(flight.departureStrings.date.substr(6), 10),
            parseInt(flight.departureStrings.time.substr(0, 2), 10),
            parseInt(flight.departureStrings.time.substr(2), 10),
            0
        ) / 1000;

    fa.GetFlightID({
            ident: flight.ident,
            departureTime: flight.departureTime
        }, function (err, result)
        {
            if (err || !result) {
                return EndWithResponse(flight, 'Error fetching flight ID for ' + flight.ident + ' ' + flight.departureTime, err);
            }

            flight.faFlightID = result;

            ProcessFlightByFAFlightID(flight);
        }
    );
}

function ProcessFlightByFAFlightID(flight)
{
    var airlineCode = getAirlineFromIdent(flight.ident);

    var getAirlineFlightInfo = airlineCode ?
        fa.AirlineFlightInfo.bind(fa, flight.faFlightID) :
        function(cb) { cb(null, {
            tailnumber: flight.ident,
            codeshares: []
        })};

    async.parallel([ getAirlineFlightInfo, fa.FlightInfoEx.bind(fa, {ident: flight.faFlightID})],
        function (err, results) {
            flight.airlineFlightInfo = results[0] || {};
            flight.flightInfoEx = {};

            if (results[1] && results[1].flights) {
                flight.flightInfoEx = results[1].flights[0];
            } else {
                return ProcessFlightFromADSBExchange(flight);
            }

            ProcessFullFlight(flight);
        }
    );
}

function ProcessFlightFromADSBExchange(flight) {
    https.get('https://public-api.adsbexchange.com/VirtualRadar/AircraftList.json?fIcoQ=' + flight.icao, function(res) {
        if (res.statusCode != 200) {
            console.log('could not get aircraft info for icao ' + flight.icao + ' from adsbexchange');
            res.resume();
            return ProcessFullFlight(flight);
        }

        res.setEncoding('utf8');
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
            var json = JSON.parse(data);
            if (json.acList && json.acList.length) {
                flight.flightInfoEx.aircrafttype = json.acList[0].Type;
            }

            ProcessFullFlight(flight);
        });
    }).on('error', function(e) {
        console.log('Got error fetching adsbexchange info for ' + flight.icao + ': ' + e.message);
        ProcessFullFlight(flight);
    });
}

function ProcessFullFlight(flight) {
    flight.tailnumber = flight.airlineFlightInfo.tailnumber || flight.ident;

    var airlineCode = flight.tailnumber != flight.ident ? getAirlineFromIdent(flight.ident) : false;

    var imageParams = {};
    if (flight.airlineFlightInfo.tailnumber) {
        imageParams.tail = flight.airlineFlightInfo.tailnumber;
    } else if (flight.flightInfoEx.aircrafttype) {
        imageParams.type = flight.flightInfoEx.aircrafttype;
    }

    if (airlineCode && flight.airlineFlightInfo.codeshares) {
        var flightNum = flight.ident.match(/\d+/)[0];
        for (var x = 0; x < flight.airlineFlightInfo.codeshares.length; x++) {
            if (flight.airlineFlightInfo.codeshares[x].substr(flightNum.length * -1) == flightNum) {
                airlineCode = getAirlineFromIdent(flight.airlineFlightInfo.codeshares[x]) || airlineCode;
                flight.bestCodeshare = flight.airlineFlightInfo.codeshares[x];
                break;
            }
        }
    }

    var rf = (function(cb) { return cb(false); });

    var getAirline = airlineCode ? fa.AirlineInfo.bind(fa, airlineCode) : rf;
    var getAircraftType = flight.flightInfoEx.aircrafttype ? fa.AircraftType.bind(fa, flight.flightInfoEx.aircrafttype) : rf;

    async.parallel([
        aircraftImage.getAircraftImage.bind(aircraftImage, imageParams),
        getAircraftType,
        getAirline,
    ], function(err, results) {
        var img = results[0] || {};
        var info = results[1] || {};
        var airline = results[2] || {};

        var flightName = (flight.bestCodeshare || flight.ident);

        var str = '';
        if (airline && airline.shortname) {
            str += airline.shortname + ' ';
        }
        str += flightName + ': ';

        if (info.manufacturer) {
            str += info.manufacturer + ' ';
            if (info.type) {
                str += info.type + ' ';
            }
        } else if (flight.flightInfoEx.aircrafttype) {
            str += flight.flightInfoEx.aircrafttype + ' ';
        }
        if (flight.tailnumber && flight.tailnumber != flightName) {
            str += '(' + flight.tailnumber + ') ';
        }
        if (flight.flightInfoEx.originCity) {
            str += 'from ' + flight.flightInfoEx.originCity + ' (' + flight.flightInfoEx.origin + ') ';
        }

        str = str.replace(/[^\w\)]+$/, '');
        SendTweet(str, img);

        return EndWithResponse(flight, str);
    });
}

function SendTweet(message, image) {
    console.log('Tweet: ' + message);

    if (!twitter) {
        return;
    }

    var updateParams = {
        status: message,
        enable_dm_commands: false
    };

    var f = function(params, err, tweet, response) {
        if (err) {
            console.log(err);
            return;
        }

        twitter.post('statuses/update', params, function(err, tweet, response) {
            if (err) {
                console.log(err);
            }
        });
    };

    if (!image) {
        return f(updateParams);
    }

    twitter.post('media/upload', { media: image }, function(err, media, response) {
        if (err) {
            console.log(err);
            return;
        }

        updateParams.media_ids = media.media_id_string;
        f(updateParams);
    });
}

function getAirlineFromIdent(ident) {
    var m;
    if (m = ident.match(/^([A-Z]{3,5})\d*$/)) {
        return m[1];
    }
    return false;
}

function typeImageTest() {
    var types = ['C172', 'CRJ9', 'DH8B', 'BE30'];

    var f = function (t, err, image)
    {
        console.log(t + ' Image returned: ' + image.length);
    };

    for (var x = 0, t; t = types[x]; x++) {
        aircraftImage.getAircraftImage({type: t}, f.bind(null, t));
    }
}

function typeInfoTest() {
    var types = ['C172', 'CRJ9', 'DH8B'];

    var f = function (t, err, info)
    {
        console.log(info);
    };

    for (var x = 0, t; t = types[x]; x++) {
        fa.AircraftType(t, f.bind(null, t));
    }
}
