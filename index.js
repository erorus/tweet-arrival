const API_URL = 'http://' + process.env.FLIGHTAWARE_CREDENTIALS + '@flightxml.flightaware.com/json/FlightXML2/';

const aircrafttype = new (require('./aircrafttype'))(API_URL),
    http = require('http'),
    async = require('async');

const secondsBeforeArrival = process.env.SECONDS_AHEAD;

var enroute;
var identTimers = {};

FetchEnroute();
//typeImageTest();

function FetchEnroute() {
    var retryDelay = 10 * 60 * 1000;

    console.log('Fetching enroute data');
    http.get(API_URL + 'Enroute?airport=' + process.env.AIRPORT, function(res) {
        if (res.statusCode != 200) {
            console.log('Received error ' + res.statusCode + ' fetching Enroute data');
            setTimeout(FetchEnroute, retryDelay);
            return;
        }

        res.setEncoding('utf8');

        var data = '';
        res.on('data', function(chunk) {
            data += chunk;
        });

        res.on('end', function() {
            try {
                var json = JSON.parse(data);
            } catch (e) {
                console.log('Could not parse Enroute json!');
                setTimeout(FetchEnroute, retryDelay);
                return;
            }

            if (!json.hasOwnProperty('EnrouteResult')) {
                console.log('Enroute json did not include enroute result!');
                setTimeout(FetchEnroute, retryDelay);
                return;
            }

            enroute = json.EnrouteResult.enroute;

            var now = Math.floor((new Date()).valueOf() / 1000);
            var refreshSoon = false;

            for (var x = 0; x < enroute.length; x++) {
                refreshSoon |= (enroute[x].estimatedarrivaltime < (now + 3600))
            }

            setTimeout(FetchEnroute, (refreshSoon ? 30 : 60) * 60 * 1000);

            UpdateTimers();
        });
    });
}

function UpdateTimers() {
    for (var k in identTimers) {
        if (!identTimers.hasOwnProperty(k)) {
            continue;
        }

        console.log('Clearing timer for ' + k);
        clearTimeout(identTimers[k]);
    }

    var t, now = Math.floor((new Date()).valueOf() / 1000);

    identTimers = {};
    for (var x = 0; x < enroute.length; x++) {
        if (enroute[x].estimatedarrivaltime - secondsBeforeArrival < now) {
            continue;
        }
        if (enroute[x].estimatedarrivaltime < (now + 3600) || enroute[x].actualdeparturetime) {
            t = (enroute[x].estimatedarrivaltime - secondsBeforeArrival - now);
            console.log('Setting timer for ' + enroute[x].ident + ' in ' + t + ' seconds');
            identTimers[enroute[x].ident] = setTimeout(AlertEnroute.bind(null, enroute[x]), t * 1000);
        }
        //AlertEnroute(enroute[x]);
    }
}

function AlertEnroute(flight) {
    async.parallel([
        aircrafttype.getImage.bind(aircrafttype, flight.aircrafttype),
        aircrafttype.getInfo.bind(aircrafttype, flight.aircrafttype),
        aircrafttype.getAirline.bind(aircrafttype, flight.ident),
    ], function(err, results) {
        var img = results[0];
        var info = results[1];
        var airline = results[2];

        var str = '';
        if (airline.shortname) {
            str += airline.shortname + ': ';
        }
        if (info.manufacturer) {
            str += info.manufacturer + ' ';
            if (info.type) {
                str += info.type + ' ';
            }
        } else {
            str += flight.aircrafttype + ' ';
        }
        str += 'from ' + flight.originCity + ' (' + flight.origin + ') ';
        str += 'arriving at ' + (new Date(flight.estimatedarrivaltime * 1000)).toLocaleTimeString();

        SendTweet(str, img ? [img] : []);
    });
}

function SendTweet(message, images) { // TODO
    console.log('Tweet: ' + message);
}

function typeImageTest() {
    var types = ['C172', 'CRJ9', 'DH8B', 'BE30'];

    var f = function (t, err, image)
    {
        console.log(t + ' Image returned: ' + image.length);
    };

    for (var x = 0, t; t = types[x]; x++) {
        aircrafttype.getImage(t, f.bind(null, t));
    }
}

function typeInfoTest() {
    var types = ['C172', 'CRJ9', 'DH8B'];

    var f = function (t, err, info)
    {
        console.log(info);
    };

    for (var x = 0, t; t = types[x]; x++) {
        aircrafttype.getInfo(t, f.bind(null, t));
    }
}
