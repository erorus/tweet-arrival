const fs = require('fs'),
    http = require('http'),
    jsdom = require("jsdom");

function AircraftType(apiurl) {
    this.api = apiurl;
}

module.exports = AircraftType;

AircraftType.prototype.getImage = function (type, callback) {
    var path = getTypePath(type) + '.jpg';
    var self = this;

    fs.readFile(path, function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                console.log('Finding image for new type ' + type);
                return downloadTypeImage.call(self, type, callback);
            }

            throw err;
        }

        callback(null, data);
    });
};

AircraftType.prototype.getInfo = function (type, callback) {
    var path = getTypePath(type) + '.json';
    var self = this;

    fs.readFile(path, function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                console.log('Finding info for new type ' + type);
                return downloadTypeInfo.call(self, type, callback);
            }

            throw err;
        }

        if (!data) {
            data = '{}';
        }

        var json = JSON.parse(data);
        if (json.hasOwnProperty('AircraftTypeResult')) {
            return callback(null, json.AircraftTypeResult);
        }

        callback(null, {});
    });
};

AircraftType.prototype.getAirline = function (flightName, callback) {
    var airline = '';
    var m;
    if (m = flightName.match(/^([A-Z]{3,5})\d*$/)) {
        airline = m[1];
    } else {
        return callback(null, {});
    }

    var path = getTypePath(airline) + '.airline.json';
    var self = this;

    fs.readFile(path, function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                console.log('Finding info for new airline ' + airline);
                return downloadAirlineInfo.call(self, airline, callback);
            }

            throw err;
        }

        if (!data) {
            data = '{}';
        }

        var json = JSON.parse(data);
        if (json.hasOwnProperty('AirlineInfoResult')) {
            return callback(null, json.AirlineInfoResult);
        }

        callback(null, {});
    });
};


function getTypePath(type) {
    return __dirname + '/aircrafttype/' + type;
}

function downloadTypeImage(type, callback) {
    var self = this;

    jsdom.env('http://flightaware.com/photos/aircrafttype/' + type, function(err, window) {
        var photoDivs = window.document.getElementsByClassName('photoMarker');

        var candidates = [];
        var div, value;
        while (photoDivs.length) {
            div = photoDivs[0].parentNode.removeChild(photoDivs[0]);

            var attr = {};
            for (var x = 0; x < div.attributes.length; x++) {
                value = div.attributes[x].value;
                if (/^\d+(\.\d+)?$/.test(value)) {
                    value = (value.indexOf('.') < 0) ? parseInt(value, 10) : parseFloat(value);
                }
                attr[div.attributes[x].name] = value;
            }

            if (attr.comments && attr.comments > 10) {
                continue;
            }

            if (!attr.width || attr.width < 512) {
                continue;
            }

            if (!attr.storage_id || !attr.average || !attr.votes) {
                continue;
            }

            attr.lowVotes = attr.votes > 15 ? 1 : 0;
            attr.perfect = attr.average >= 4.9 ? 1 : 0;
            attr.hasComments = attr.comments > 5 ? 1 : 0;

            candidates.push(attr);
        }

        candidates.sort(function(a,b){
            return (a.lowVotes - b.lowVotes) ||
                (a.perfect - b.perfect) ||
                (a.hasComments - b.hasComments) ||
                (b.average - a.average) ||
                (b.votes - a.votes);
        });

        getPhotoFromBestDiv.call(self, type, candidates, callback);
    });
}

function getPhotoFromBestDiv(type, candidates, callback) {
    var self = this;

    if (!candidates.length) {
        console.log('No more candidates for type ' + type);
        fs.writeFile(getTypePath(type) + '.jpg', '');
        return callback(null, '');
    }

    var attr, url;
    attr = candidates.shift();
    url = 'http://photos.flightaware.com/photos/retriever/' + attr.storage_id;

    http.get(url, function(res) {
        if (res.statusCode != 200) {
            res.resume();
            return getPhotoFromBestDiv(type, divs, callback);
        }

        var path = getTypePath(type) + '.jpg';
        var writable = fs.createWriteStream(path);
        res.on('end', function() {
            self.getImage(type, callback);
        });

        res.pipe(writable);
        res.resume();
    });
}

function downloadTypeInfo(type, callback) {
    var self = this;
    var url = self.api + 'AircraftType?type=' + type;
    var path = getTypePath(type) + '.json';

    http.get(url, function(res) {
        if (res.statusCode != 200) {
            console.log('No type info for ' + type);
            res.resume();
            fs.writeFile(path, '{}');
            return callback(null, {});
        }

        var writable = fs.createWriteStream(path);
        res.on('end', function() {
            self.getInfo(type, callback);
        });

        res.pipe(writable);
        res.resume();
    });
}

function downloadAirlineInfo(airline, callback) {
    var self = this;
    var url = self.api + 'AirlineInfo?airlineCode=' + airline;
    var path = getTypePath(airline) + '.airline.json';

    http.get(url, function(res) {
        if (res.statusCode != 200) {
            console.log('No airline info for ' + airline);
            res.resume();
            fs.writeFile(path, '{}');
            return callback(null, {});
        }

        var writable = fs.createWriteStream(path);
        res.on('end', function() {
            self.getAirline(airline, callback);
        });

        res.pipe(writable);
        res.resume();
    });
}
