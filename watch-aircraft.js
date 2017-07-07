const fs = require('fs'),
    http = require('http');

StartWatch(process.env.JSON_DIR + '/aircraft.json');

var lat = parseFloat(process.env.LAT);
var lon = parseFloat(process.env.LON);
var distKM = parseFloat(process.env.DISTANCE);
var altFT = parseInt(process.env.ALTITUDE);

var seen = {};

function StartWatch(jsonPath) {
    var watcher = fs.watch(jsonPath, function() {
        watcher.close();
        fs.readFile(jsonPath, function(err, data) {
            StartWatch(jsonPath);
            if (err) {
                console.log('Error reading ' + jsonPath);
                console.log(err);
                return;
            }

            var json = JSON.parse(data);
            if (!json.now) {
                console.log('Invalid format parsing ' + jsonPath);
                return;
            }

            var recent = {};
            var dist, now = (new Date()).valueOf();
            for (var aircraft, x = 0; aircraft = json.aircraft[x]; x++) {
                recent[aircraft.hex] = true;

                if (!aircraft.hasOwnProperty('lat') || !aircraft.hasOwnProperty('lon') || !aircraft.altitude) {
                    continue;
                }


                if (aircraft.altitude < altFT && (dist = CoordDistance(lat, lon, aircraft.lat, aircraft.lon)) < distKM) {
                    if (!seen[aircraft.hex]) {
                        console.log(aircraft.hex, now, '' + aircraft.altitude + 'ft ' + dist + 'km');
                        pingTweetArrival(aircraft.hex);
                    }
                    seen[aircraft.hex] = now;
                }
            }
            for (var k in seen) {
                if (!seen.hasOwnProperty(k)) {
                    continue;
                }
                if (!recent[k] && (seen[k] < (now - 20 * 60 * 1000))) {
                    delete seen[k];
                }
            }
        });
    });
}

function pingTweetArrival(icao) {
    http.get(process.env.TWEET_ARRIVAL_URL + icao, function(res) {
        if (res.statusCode != 200) {
            console.log('error sending ping to ' + process.env.TWEET_ARRIVAL_URL);
            res.resume();
            return;
        }

        res.setEncoding('utf8');
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
            console.log(chunk);
        });
    });
}

// via https://github.com/chrisveness/geodesy

/** Extend Number object with method to convert numeric degrees to radians */
if (Number.prototype.toRadians === undefined) {
    Number.prototype.toRadians = function() { return this * Math.PI / 180; };
}

function CoordDistance(lat1, lon1, lat2, lon2) {
    var R = 6371e3; // metres
    var φ1 = lat1.toRadians();
    var φ2 = lat2.toRadians();
    var Δφ = (lat2-lat1).toRadians();
    var Δλ = (lon2-lon1).toRadians();

    var a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ/2) * Math.sin(Δλ/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    var d = R * c;

    return d/1000; // km
}