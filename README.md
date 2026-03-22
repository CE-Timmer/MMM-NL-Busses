# MMM-NL-Busses
MagicMirror2 - Dutch bus times

Shows departures of buses, trams, metros and ferries for any stop in the Netherlands.
Based on data from OVapi, a public API for Dutch public transport information.
For train departures you can use
[MMM-nstreinen](https://github.com/qistoph/MMM-nstreinen/) instead.

The module supports three different display modes, as shown in the screenshot below.
![Example screenshot](https://github.com/73cirdan/MMM-bustimes/blob/master/screenshot.png)

Specifically, these display modes are:
- *small* - Only show a single departure per stop.
- *medium* - One stop per row, with multiple departures per row.
- *large* - One departure per row (number of rows configurable).

The module instances on the right in the screenshot show some optional
additional display options. See the config section below for all supported options.

# Installation
Navigate into your MagicMirror `modules` folder and execute:

`git clone https://github.com/CE-Timmer/MMM-NL-Busses.git`

After that go into the `MMM-NL-Busses` folder and execute:

`npm install`

*Note:* This module is based on MMM-bustimes. Some forks were made with new options and bugfixes.
These were merged into MMM-bustimes in June 2022. This renamed version follows the
MagicMirror naming convention and uses `axios` instead of the deprecated `request` module.

# Update

`git pull` and `npm install`

Be sure to use `MMM-NL-Busses` as the module name in `config.js`.

# Version

| Version | Description |
| --- | --- |
| `Version 1.0.1` | **First release**<br>produced by CE-Timmer (original code by 73Cirdan) |

# Using the module

## Get your TimingPointCode or StopAreaCode

This module can show one or more public transport stops in your area, represented by a
TimingPoint code (`tpc`) or StopArea code. A TimingPoint is a single stop or platform.
Stations and other hubs often have many TimingPoints. A StopArea groups multiple
TimingPoints together into a logical cluster. This module supports both.
More information can be found on the
[OVapi wiki](https://github.com/skywave/KV78Turbo-OVAPI/wiki).

1. Open `http://v0.ovapi.nl/line/` in a browser to find your line in the list of all lines.
   You can search by city, line number, or start/end points. Most lines will have two entries:
   one for each direction.
2. Open `http://v0.ovapi.nl/line/[lineid]` to confirm the direction and find the stops on that line.
   Replace `[lineid]` with the ID you found in step 1 and write down the `TimingPointCode`
   or `StopAreaCode` you want to use.
3. Check the result:
   For a TimingPointCode use `http://v0.ovapi.nl/tpc/[tpc]`.
   For a StopAreaCode use `http://v0.ovapi.nl/stopareacode/[sac]`.
   If the returned passes look correct, copy the code into your config.

## Config options

Option | Description
------ | -----------
`timingPointCode` | One or more TimingPointCodes. Use a comma-separated list (`"code1,code2"`) if you need more than one departure list. To show arrival time and travel duration for a preferred destination, pair an origin and destination TimingPointCode with `>`: `"originCode>destinationCode"`. When a preferred destination is configured, only journeys that also stop at that destination are shown for that origin. If multiple origin stops should use the same preferred destination, repeat the destination in each pair, for example: `"53400221>53602030,53402520>53602030"`. When `stopAreaCode` is also set, results are combined.<br>**At least one of `timingPointCode` or `stopAreaCode` is required**
`stopAreaCode` | One or more StopAreaCodes. Use a comma-separated list (`"code1,code2"`) if you need more than one departure list. When `timingPointCode` is also set, results are combined.<br>**At least one of `timingPointCode` or `stopAreaCode` is required**
`displaymode` | Layout of the module.<br>*Possible values:* `"small"`, `"medium"`, `"large"`<br>**Required**
`departures` | How many departures are shown per stop (not used in *small* mode).<br>*Default value:* `3`
`skipDepartures` | Optional per-stop mapping to skip the first N matching departures before display. Keys are origin TimingPointCodes and values are the number of departures to skip. Example: `{ "53400221": 1, "53402520": 2 }` skips the first departure for `53400221` and the first two departures for `53402520`.<br>*Default value:* `{}`
`destinations` | An array with the destination codes you care about. Only lines going to one of these destinations will be shown.<br>*Default value:* `[]`
`showTownName` | Include the town name in the stop name.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`showOnlyDepartures` | Only show departures from stops. This filters out lines that terminate at a stop and do not allow boarding.<br>*Possible values:* `true` or `false`<br>*Default value:* `true`
`showDelay` | Show scheduled times and delay/early offset, for example `14:57+5` instead of `15:02`.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`showTransportTypeIcon` | Show a transport type icon next to departures.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`showTimingPointIcon` | Show a timing point icon.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`showOperator` | Display the operator name.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`showAccessible` | Show accessibility icons for the stop and line.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`showLiveIcon` | Show whether the displayed time is based on live data updated in the last 10 minutes.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`showHeader` | Show a header row in *large* display mode.<br>*Possible values:* `true` or `false`<br>*Default value:* `false`
`alwaysShowStopName` | When set to `false`, the stop name is hidden if the module is only showing a single stop in *medium* or *large* mode.<br>*Possible values:* `true` or `false`<br>*Default value:* `true`
`timeFormat` | Format of departure times shown.<br>*Possible values:* any [Moment.js format string](https://momentjs.com/docs/#/displaying/format/)<br>*Default value:* `"HH:mm"`
`combinedRoutes` | Optional mapping for through-routes that change line number before the preferred destination stop. Keys are the origin line number and values are one or more continuation line numbers used after the handoff. Example: `{ "488": ["416"] }` lets a `488` departure match a preferred destination that is only served after it continues as line `416`. You only need this when the same physical ride changes public line number before the preferred destination. If the line number stays the same all the way, this option is not needed.<br>*Default value:* `{}`
`axiosfix` | Fixes issue #15, set to `"PostmanRuntime/7.26.2"` when needed.<br>*Default:* `Do not use if there is no problem`

## Example config.js content for this module

```javascript
{
    module: "MMM-NL-Busses",
    position: "top_left",
    header: "Busses",
    config: {
        timingPointCode: "53600160>53602030",
        displaymode: "medium",
        showTownName: true,
        departures: 3,
        combinedRoutes: {
            "488": ["416"]
        }
    }
},
```

In the example above, departures from Dordrecht Centraal (`53600160`) are filtered
to journeys that also reach Leerpark (`53602030`). Because some trips continue from
line `488` to line `416`, `combinedRoutes` tells the module to keep matching that
through-service and show the preferred stop arrival time plus the trip duration.

## Example with two origin stops and one preferred destination

```javascript
{
    module: "MMM-NL-Busses",
    position: "bottom_right",
    header: "Busses",
    config: {
        timingPointCode: "53400221>53602030,53402520>53602030",
        displaymode: "large",
        showTownName: true,
        departures: 10,
        showDelay: true,
        skipDepartures: {
            "53400221": 1,
            "53402520": 0
        },
        combinedRoutes: {
            "488": ["416"]
        }
    }
},
```

In this example, the module shows departures from both `53400221` and `53402520`,
but only for journeys that continue to `53602030`. The `combinedRoutes` setting is
needed here because line `488` continues as line `416` before reaching Leerpark.
The `skipDepartures` setting skips the first matching departure for `53400221`.

# Special Thanks

Thanks to [73cirdan](https://github.com/73cirdan) 
for making the base code of this module.

The MIT License (MIT)
=====================
Copyright 2017 CE-Timmer

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of the
Software. **The software is provided "as is", without warranty of any kind,
express or implied, including but not limited to the warranties of
merchantability, fitness for a particular purpose and noninfringement. In no
event shall the authors or copyright holders be liable for any claim, damages or
other liability, whether in an action of contract, tort or otherwise, arising
from, out of or in connection with the software or the use or other dealings in
the software.**
