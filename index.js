const fa = new (require('./flightaware-cached'))(process.env.FLIGHTAWARE_USER, process.env.FLIGHTAWARE_KEY),
    aircraftImage = require('./aircraft-image'),
    async = require('async'),
    Twitter = require('twitter');

const secondsBeforeArrival = process.env.SECONDS_AHEAD;

var twitter = !process.env.TWITTER_CONSUMER_KEY ? false : new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

var identTimers = {};
var enrouteTimer = {
    timer: undefined,
    when: 0,
};

process.on('exit', function(err) {
    console.log('Exiting!');
});

FetchEnroute();
//typeImageTest();
//typeInfoTest();

function FetchEnroute() {
    var retryDelay = 10 * 60;

    console.log('Fetching enroute data');
    fa.Enroute({airport: process.env.AIRPORT}, function(err, res) {
        if (err) {
            console.log('Could not fetch enroute!');
            console.log(err);
            SetNextEnrouteTimerBy(retryDelay);
            return;
        }

        var enroute = res.enroute ? res.enroute : [];

        var t, now = Math.floor((new Date()).valueOf() / 1000);
        var refreshSoon = false;

        for (var x = 0; x < enroute.length; x++) {
            refreshSoon |= (enroute[x].estimatedarrivaltime < (now + 3600))
        }

        SetNextEnrouteTimerBy((refreshSoon ? 30 : 60) * 60);


        // add enroute timers
        for (var k in identTimers) {
            if (!identTimers.hasOwnProperty(k)) {
                continue;
            }

            console.log('Clearing timer for ' + k);
            clearTimeout(identTimers[k]);
        }

        identTimers = {};
        for (var x = 0; x < enroute.length; x++) {
            if (enroute[x].estimatedarrivaltime - secondsBeforeArrival < now) {
                continue;
            }
            if (enroute[x].estimatedarrivaltime < (now + 3600) && enroute[x].actualdeparturetime) {
                t = (enroute[x].estimatedarrivaltime - secondsBeforeArrival - now);
                console.log('Setting timer for ' + enroute[x].ident + ' in ' + t + ' seconds');
                identTimers[enroute[x].ident] = setTimeout(AlertEnroute.bind(null, enroute[x]), t * 1000);
                SetNextEnrouteTimerBy(t - 5 * 60);
            }
        }

    });
}

function SetNextEnrouteTimerBy(delaySeconds) {
    if (delaySeconds <= 0) {
        return;
    }
    var now = Math.floor((new Date()).valueOf() / 1000);
    if (enrouteTimer.when < now || enrouteTimer.when > now + delaySeconds) {
        if (enrouteTimer.when) {
            clearTimeout(enrouteTimer.timer);
        }
        enrouteTimer.when = now + delaySeconds;
        enrouteTimer.timer = setTimeout(FetchEnroute, delaySeconds * 1000);
        console.log('Next enroute fetch in ' + delaySeconds + ' seconds');
    } else {
        console.log('Ignoring enroute fetch request in ' + delaySeconds + ' seconds, will fetch in ' + (enrouteTimer.when - now) + ' seconds instead');
    }
}

function AlertEnroute(flight) {
    delete identTimers[flight.ident];

    var airlineCode = getAirlineFromIdent(flight.ident);
    var getAirline = airlineCode ? fa.AirlineInfo.bind(fa, airlineCode) : (function(cb) { return cb(false); });

    async.parallel([
        aircraftImage.getAircraftImage.bind(aircraftImage, { type: flight.aircrafttype }),
        fa.AircraftType.bind(fa, flight.aircrafttype),
        getAirline,
    ], function(err, results) {
        var img = results[0];
        var info = results[1];
        var airline = results[2];

        var str = '';
        if (airline && airline.shortname) {
            str += airline.shortname + ' ';
        }
        str += flight.ident + ': ';

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

        SendTweet(str, img);
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
