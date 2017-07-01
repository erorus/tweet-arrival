const fs = require('fs'),
    http = require('http'),
    jsdom = require("jsdom");

const CACHE_PATH = __dirname + '/aircraft-image-cache/';

exports.getAircraftImage = function (opts, callback) {

    // require type for now
    if (!opts.type) {
        callback(null, false);
    }

    var type = opts.type;

    var cache_filename = 'type-' + type + '.jpg';

    var path = CACHE_PATH + cache_filename;

    fs.readFile(path, function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                console.log('Finding image for new type ' + type);

                return downloadTypeImage(type, function(err, image) {
                    if (image) {
                        fs.writeFile(path, image);
                    }

                    callback(null, image);
                });
            }

            throw err;
        }

        callback(null, data);
    });
};

function downloadTypeImage(type, callback) {
    var url = 'http://flightaware.com/photos/aircrafttype/' + type;

    jsdom.env(url, function(err, window) {
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

        getPhotoFromBestDiv(type, candidates, callback);
    });
}

function getPhotoFromBestDiv(type, candidates, callback) {
    if (!candidates.length) {
        console.log('No more candidates for type ' + type);
        return callback(null, '');
    }

    var attr, url;
    attr = candidates.shift();
    url = 'http://photos.flightaware.com/photos/retriever/' + attr.storage_id;

    http.get(url, function(res) {
        if (res.statusCode != 200) {
            res.resume();
            return getPhotoFromBestDiv(type, candidates, callback);
        }

        var data = new Buffer(0);
        res.on('data', function(chunk) {
            data = Buffer.concat([data, chunk]);
        });
        res.on('end', function() {
            callback(null, data);
        });
        res.resume();
    });
}