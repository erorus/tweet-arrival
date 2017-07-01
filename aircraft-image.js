const fs = require('fs'),
    http = require('http'),
    jsdom = require("jsdom"),
    async = require('async');

const CACHE_PATH = __dirname + '/aircraft-image-cache/';

exports.getAircraftImage = function (opts, callback) {

    var tasks = [];
    if (opts.tail) {
        tasks.push(fetchImage.bind(null,
            CACHE_PATH + 'tail-' + opts.tail + '.jpg',
            'aircraft/' + opts.tail));
    }
    if (opts.type) {
        tasks.push(fetchImage.bind(null,
            CACHE_PATH + 'type-' + opts.type + '.jpg',
            'aircrafttype/' + opts.type));
    }

    if (!tasks.length) {
        return callback({
            error: 'No valid params for search!'
        }, null);
    }

    async.tryEach(tasks, callback);
};

function fetchImage(filePath, urlPath, callback) {
    fs.readFile(filePath, function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                console.log('Finding new image at ' + urlPath);
                return downloadBestImage(urlPath, function(err, image) {
                    if (image) {
                        fs.writeFile(filePath, image);
                    } else if (!err) {
                        err = {
                            error: 'No image found'
                        };
                    }

                    callback(err, image);
                });
            }

            throw err;
        }

        callback(null, data);
    });
}

function downloadBestImage(path, callback) {
    var url = 'http://flightaware.com/photos/' + path;

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

            if (!attr.width || attr.width < 512) {
                continue;
            }

            if (!attr.storage_id) {
                continue;
            }

            attr.manyVotes = attr.votes > 15 ? 1 : 0;
            attr.perfect = attr.average >= 4.9 ? 1 : 0;
            attr.hasComments = attr.comments > 5 ? 1 : 0;
            attr.hasManyComments = attr.comments > 10 ? 1 : 0;

            candidates.push(attr);
        }

        candidates.sort(function(a,b){
            return (a.manyVotes - b.manyVotes) ||
                (a.perfect - b.perfect) ||
                (a.hasComments - b.hasComments) ||
                (b.average - a.average) ||
                (a.hasManyComments - b.hasManyComments) ||
                (b.votes - a.votes);
        });

        getPhotoFromBestDiv(candidates, callback);
    });
}

function getPhotoFromBestDiv(candidates, callback) {
    if (!candidates.length) {
        return callback(null, '');
    }

    var attr, url;
    attr = candidates.shift();
    url = 'http://photos.flightaware.com/photos/retriever/' + attr.storage_id;

    http.get(url, function(res) {
        if (res.statusCode != 200) {
            res.resume();
            return getPhotoFromBestDiv(candidates, callback);
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