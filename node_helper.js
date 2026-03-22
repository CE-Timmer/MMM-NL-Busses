'use strict';

/* MagicMirror²
 * Module: MMM-NL-Busses
 *
 * Adapted for Dutch system by Cirdan
 * Origin by Stefan Krause
 * MIT Licensed.
 */

const NodeHelper = require('node_helper');
const axios = require("axios").default;

/*
 * A wrapper for axios.get that throws an error if the status code is not 200.
 */
const getCheckedAsync = (url) =>
    
    axios.get(url)
    .catch(err => {
        throw new Error("Error fetching " + url + ": " + err);
    })
    .then(({status, data}) => {
        if (status !== 200)
            throw new Error("Error fetching " + url + ": Status " + status);
        return data;
    });

module.exports = NodeHelper.create({
    parseTimingPointEntries: function(config) {
        if (Array.isArray(config.timingPointEntries) && config.timingPointEntries.length > 0)
            return config.timingPointEntries;

        const rawEntries = Array.isArray(config.timingPointCode) ?
            config.timingPointCode :
            String(config.timingPointCode || "").split(",");

        return rawEntries
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
            .map((entry) => {
                const [originTimingPointCode, preferredDestinationTimingPointCode] = entry
                    .split(">")
                    .map((part) => part.trim());

                return {
                    originTimingPointCode: originTimingPointCode,
                    preferredDestinationTimingPointCode: preferredDestinationTimingPointCode || null
                };
            })
            .filter((entry) => entry.originTimingPointCode);
    },

    buildJourneyKey: function(pass) {
        return [
            pass.DataOwnerCode || "",
            pass.OperationDate || "",
            pass.LinePlanningNumber || "",
            pass.JourneyNumber || "",
            pass.JourneyPatternCode || ""
        ].join("|");
    },

    buildContinuationKey: function(pass) {
        return [
            pass.DataOwnerCode || "",
            pass.OperationDate || "",
            pass.JourneyNumber || ""
        ].join("|");
    },

    indexDestinationPasses: function(data) {
        const journeyIndex = {};
        const continuationIndex = {};

        for (const [timingPointCode, stopData] of Object.entries(data)) {
            if (!stopData || !stopData.Passes)
                continue;

            if (!journeyIndex[timingPointCode])
                journeyIndex[timingPointCode] = {};
            if (!continuationIndex[timingPointCode])
                continuationIndex[timingPointCode] = {};

            for (const pass of Object.values(stopData.Passes)) {
                journeyIndex[timingPointCode][this.buildJourneyKey(pass)] = pass;

                const continuationKey = this.buildContinuationKey(pass);
                if (!continuationIndex[timingPointCode][continuationKey])
                    continuationIndex[timingPointCode][continuationKey] = [];
                continuationIndex[timingPointCode][continuationKey].push(pass);
            }
        }

        return {
            exact: journeyIndex,
            continuation: continuationIndex
        };
    },

    getContinuationLines: function(config, linePublicNumber) {
        if (!config.combinedRoutes)
            return [];

        const configuredLines = config.combinedRoutes[linePublicNumber];
        if (configuredLines === undefined)
            return [];

        if (Array.isArray(configuredLines))
            return configuredLines.map((line) => String(line));

        return [String(configuredLines)];
    },

    getPassDateTime: function(pass) {
        return new Date(
            pass.ExpectedArrivalTime ||
            pass.TargetArrivalTime ||
            pass.ExpectedDepartureTime ||
            pass.TargetDepartureTime
        );
    },

    findTimeBasedContinuationPass: function(pass, preferredDestinationCode, destinationPassIndex, continuationLines) {
        const continuationPasses = destinationPassIndex.continuation[preferredDestinationCode];
        if (!continuationPasses)
            return null;

        const departureTime = this.getPassDateTime(pass);
        if (!(departureTime instanceof Date) || Number.isNaN(departureTime.getTime()))
            return null;

        const maxArrivalTime = departureTime.getTime() + (120 * 60 * 1000);
        const candidates = [];

        for (const destinationPassList of Object.values(continuationPasses)) {
            for (const candidate of destinationPassList) {
                if (String(candidate.DataOwnerCode || "") !== String(pass.DataOwnerCode || ""))
                    continue;
                if (String(candidate.OperationDate || "") !== String(pass.OperationDate || ""))
                    continue;
                if (!continuationLines.includes(String(candidate.LinePublicNumber)))
                    continue;

                const candidateTime = this.getPassDateTime(candidate);
                if (!(candidateTime instanceof Date) || Number.isNaN(candidateTime.getTime()))
                    continue;
                if (candidateTime.getTime() < departureTime.getTime())
                    continue;
                if (candidateTime.getTime() > maxArrivalTime)
                    continue;

                candidates.push(candidate);
            }
        }

        if (candidates.length === 0)
            return null;

        candidates.sort((left, right) => this.getPassDateTime(left) - this.getPassDateTime(right));
        return candidates[0];
    },

    findPreferredDestinationPass: function(pass, preferredDestinationCode, destinationPassIndex, config) {
        if (!preferredDestinationCode)
            return null;

        const exactPasses = destinationPassIndex.exact[preferredDestinationCode];
        const exactMatch = exactPasses && exactPasses[this.buildJourneyKey(pass)];
        if (exactMatch)
            return exactMatch;

        const continuationLines = this.getContinuationLines(config, pass.LinePublicNumber);
        if (continuationLines.length === 0)
            return null;

        const continuationPasses = destinationPassIndex.continuation[preferredDestinationCode];
        const possibleMatches = continuationPasses &&
            continuationPasses[this.buildContinuationKey(pass)];

        if (possibleMatches && possibleMatches.length > 0) {
            const directContinuationMatch = possibleMatches.find((candidate) =>
                continuationLines.includes(String(candidate.LinePublicNumber))
            );
            if (directContinuationMatch)
                return directContinuationMatch;
        }

        return this.findTimeBasedContinuationPass(
            pass,
            preferredDestinationCode,
            destinationPassIndex,
            continuationLines
        ) || null;
    },

    enrichPreferredDestination: function(pass, preferredDestinationPass) {
        if (!preferredDestinationPass)
            return null;

        const departureTime = pass.ExpectedDepartureTime || pass.TargetDepartureTime;
        const arrivalTime = preferredDestinationPass.ExpectedArrivalTime ||
            preferredDestinationPass.TargetArrivalTime ||
            preferredDestinationPass.ExpectedDepartureTime ||
            preferredDestinationPass.TargetDepartureTime;

        if (!departureTime || !arrivalTime)
            return null;

        const durationMs = new Date(arrivalTime) - new Date(departureTime);
        const travelDurationMinutes = Math.round(durationMs / 60000);

        if (!Number.isFinite(travelDurationMinutes) || travelDurationMinutes < 0)
            return null;

        return {
            PreferredArrivalTime: arrivalTime,
            PreferredDestinationName: preferredDestinationPass.TimingPointName || preferredDestinationPass.UserStopCode,
            TravelDurationMinutes: travelDurationMinutes
        };
    },

    /*
     * Fetch data for given codes (if any) from the API at a given endpoint.
     * Returns a promise with the parsed object.
     */
    fetchData: function(config, endpoint, code, departuresOnly = config.showOnlyDepartures) {
        if (!code)
            return Promise.resolve({});

        let url = config.apiBase + "/" + endpoint + "/" + code;
        if (departuresOnly)
            url += "/" + config.departuresOnlySuffix;

        return getCheckedAsync(url)
    },

    /*
     * Merge data from multiple TimingPoints and StopAreas into a single object,
     * with an entry per TimingPointCode. This effectively flattens the StopArea
     * data.
     */
    mergeData: function(timingPointData, stopAreaData) {
        const ret = {};
        Object.assign(ret, timingPointData);
        //console.log(timingPointData);
        for (const stopArea of Object.values(stopAreaData)) {
            Object.assign(ret, stopArea);
       	    //console.log(stopArea);
	}
        return ret;
    },

    /*
     * Process received data, with info per TimingPoint, into a list of departures per
     * stop, where TimingPoints are aggregated based on their name.
     */
    processData: function(data, destinationFilter, includeTownName, debug, routeEntries, destinationPassIndex, config) {
        const departures = {};
        const routeByOriginCode = {};

        for (const routeEntry of routeEntries)
            routeByOriginCode[routeEntry.originTimingPointCode] = routeEntry;

        // Go over results for each requested tpc (e.g., bus stop). For each tpc
        // we get info about the stop itself, and all the passes (i.e.,
        // arrivals/departures of vehicles).
        for (const stopData of Object.values(data)) {
            if (!stopData || !stopData.Stop || !stopData.Passes)
                continue;

            const {Stop, Passes} = stopData;
            const timingPointName = includeTownName ?
                Stop.TimingPointTown + ", " + Stop.TimingPointName :
                Stop.TimingPointName;

            const timingPointWheelChairAccessible = (Stop.TimingPointWheelChairAccessible == "ACCESSIBLE") ? 1 : 0;
            const timingPointVisualAccessible = (Stop.TimingPointVisualAccessible == "ACCESSIBLE") ? 1 : 0;

            if (!departures[timingPointName])
                departures[timingPointName] = [];

            for (const pass of Object.values(Passes)) {
                const destination = pass.DestinationName50 || "?";
                const operator = pass.OperatorCode || pass.DataOwnerCode || "?";
                const routeEntry = routeByOriginCode[pass.TimingPointCode] || {};
                const preferredDestinationCode = routeEntry.preferredDestinationTimingPointCode;
                const preferredDestinationPass = this.findPreferredDestinationPass(
                    pass,
                    preferredDestinationCode,
                    destinationPassIndex,
                    config
                );

                if (destinationFilter.length > 0 &&
                    !destinationFilter.includes(pass.DestinationCode)) {
                    if (debug)
                        console.log(this.name + ": Skipped line " + pass.LinePublicNumber +
                            " with destination " + pass.DestinationCode + " (" + destination + ")");
                    continue;
                }

                if (preferredDestinationCode && !preferredDestinationPass) {
                    if (debug)
                        console.log(this.name + ": Skipped line " + pass.LinePublicNumber +
                            " because it does not reach timing point " + preferredDestinationCode);
                    continue;
                }

                const wheelchairAccessible = (pass.WheelChairAccessible == "ACCESSIBLE") ? 1 : 0;
                const preferredDestination = this.enrichPreferredDestination(pass, preferredDestinationPass);

                departures[timingPointName].push({
                    TargetDepartureTime: pass.TargetDepartureTime,
                    ExpectedDepartureTime: pass.ExpectedDepartureTime,
                    TransportType: pass.TransportType,
                    LinePublicNumber: pass.LinePublicNumber,
                    LineWheelChairAccessible: wheelchairAccessible,
                    TimingPointName: pass.TimingPointName,
                    TimingPointWheelChairAccessible: timingPointWheelChairAccessible,
                    TimingPointVisualAccessible: timingPointVisualAccessible,
                    Operator: operator,
                    LastUpdateTimeStamp: pass.LastUpdateTimeStamp,
                    Destination: destination,
                    PreferredDestinationCode: preferredDestinationCode || null,
                    PreferredArrivalTime: preferredDestination ? preferredDestination.PreferredArrivalTime : null,
                    PreferredDestinationName: preferredDestination ? preferredDestination.PreferredDestinationName : null,
                    TravelDurationMinutes: preferredDestination ? preferredDestination.TravelDurationMinutes : null,
                    PreferredDestinationLinePublicNumber: preferredDestinationPass ? preferredDestinationPass.LinePublicNumber : null
                });
            }

            // If we filtered out all departures for this stop, remove stop
            // itself too.
            if (departures[timingPointName].length == 0)
                delete departures[timingPointName];
        }
	//console.log(departures);
        // Sort departures by time, per timingpoint.
        for (const departureList of Object.values(departures))
            departureList.sort(
                (obj1, obj2) => obj1["ExpectedDepartureTime"].localeCompare(
                    obj2["ExpectedDepartureTime"]));

	return departures;
    },

    /*
     * Requests data for TimingPoints and StopAreas, combining and parsing the
     * results, and sending it back to the module to display.
     */
    getData: function(moduleIdentifier, config) {
        const routeEntries = this.parseTimingPointEntries(config);
        const originTimingPointCodes = routeEntries.map((entry) => entry.originTimingPointCode);
        const preferredDestinationCodes = [...new Set(routeEntries
            .map((entry) => entry.preferredDestinationTimingPointCode)
            .filter((code) => code))];

        const fetchTimingPoints = this.fetchData(
            config,
            config.timingPointEndpoint,
            originTimingPointCodes.join(",") || config.timingPointCode
        );
        const fetchStopAreas = this.fetchData(config, config.stopAreaEndpoint, config.stopAreaCode);
        const fetchPreferredDestinations = this.fetchData(
            config,
            config.timingPointEndpoint,
            preferredDestinationCodes.join(","),
            false
        );

        Promise.all([fetchTimingPoints, fetchStopAreas, fetchPreferredDestinations])
        .then(([timingPointData, stopAreaData, preferredDestinationData]) => ({
            data: this.mergeData(timingPointData, stopAreaData),
            preferredDestinationData: preferredDestinationData
        }))
        .then(({data, preferredDestinationData}) =>
            this.processData(
                data,
                config.destinations,
                config.showTownName,
                config.debug,
                routeEntries,
                this.indexDestinationPasses(preferredDestinationData),
                config
            )
        )
        .then(data =>
            this.sendSocketNotification("DATA", {
                identifier: moduleIdentifier,
                data: data
            })
        )
        .catch(err => {
            console.log(this.name + ": " + err);
            this.sendSocketNotification("ERROR", {
                identifier: moduleIdentifier,
                error: err.message
            })
        });
    },

    socketNotificationReceived: function(notification, payload) {
        const axiosfix = payload.config.axiosfix;
        if (axiosfix && axiosfix !== "") {
            axios.defaults.headers.common['User-Agent'] = axiosfix;
        } // issue 15

        if (notification === 'GETDATA')
            this.getData(payload.identifier, payload.config);
    }
});
