# Tweet-Arrival

This will tweet imminent flight arrivals for a given airport, including the name and image of the aircraft type, and the name of airline.

## Requirements

Uses the [Flightaware API](http://flightaware.com/commercial/flightxml/), for which you will need your own API key.

Uses the Twitter API, for which you'll need an API key and secret for the tweeting account.

Requires dump1090 generating aircraft.json, which will be read to determine nearby aircraft.

## Configuration/Setup

Set the environment variables in `environment.txt`.

You can run the tweeter as a systemd service with the supplied `tweet-arrival.service` template.

You also run the watch-aircraft service with `watch-aircraft.service.dist`

## License

Copyright 2017 Gerard Dombroski

Licensed under the Apache License, Version 2.0 (the "License");
you may not use these files except in compliance with the License.
You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.