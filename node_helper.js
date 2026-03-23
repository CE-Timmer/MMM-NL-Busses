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
        return this.getCombinedRouteRule(config, linePublicNumber).lines;
    },

    getCombinedRouteRule: function(config, linePublicNumber) {
        if (!config.combinedRoutes)
            return {
                lines: [],
                viaTimingPointCode: null,
                viaOriginTimingPointCode: null,
                viaContinuationTimingPointCode: null,
                maxTransferMinutes: 20,
                offsetDepartures: 0
            };

        const configuredRule = config.combinedRoutes[linePublicNumber];
        if (configuredRule === undefined)
            return {
                lines: [],
                viaTimingPointCode: null,
                viaOriginTimingPointCode: null,
                viaContinuationTimingPointCode: null,
                maxTransferMinutes: 20,
                offsetDepartures: 0
            };

        if (Array.isArray(configuredRule)) {
            return {
                lines: configuredRule.map((line) => String(line)),
                viaTimingPointCode: null,
                viaOriginTimingPointCode: null,
                viaContinuationTimingPointCode: null,
                maxTransferMinutes: 20,
                offsetDepartures: 0
            };
        }

        if (typeof configuredRule === "object" && configuredRule !== null) {
            const rawLines = Array.isArray(configuredRule.lines) ?
                configuredRule.lines :
                configuredRule.line !== undefined ?
                    [configuredRule.line] :
                    [];

            return {
                lines: rawLines.map((line) => String(line)),
                viaTimingPointCode: configuredRule.viaTimingPointCode || configuredRule.via || null,
                viaOriginTimingPointCode:
                    configuredRule.viaOriginTimingPointCode ||
                    configuredRule.viaFromTimingPointCode ||
                    configuredRule.viaOrigin ||
                    null,
                viaContinuationTimingPointCode:
                    configuredRule.viaContinuationTimingPointCode ||
                    configuredRule.viaToTimingPointCode ||
                    configuredRule.viaContinuation ||
                    null,
                maxTransferMinutes: Number.isFinite(configuredRule.maxTransferMinutes) ?
                    configuredRule.maxTransferMinutes :
                    20,
                offsetDepartures: Number.isInteger(configuredRule.offsetDepartures) ?
                    Math.max(0, configuredRule.offsetDepartures) :
                    Number.isInteger(configuredRule.departureOffset) ?
                        Math.max(0, configuredRule.departureOffset) :
                        0
            };
        }

        return {
            lines: [String(configuredRule)],
            viaTimingPointCode: null,
            viaOriginTimingPointCode: null,
            viaContinuationTimingPointCode: null,
            maxTransferMinutes: 20,
            offsetDepartures: 0
        };
    },

    getPassDateTime: function(pass) {
        return new Date(
            pass.ExpectedArrivalTime ||
            pass.TargetArrivalTime ||
            pass.ExpectedDepartureTime ||
            pass.TargetDepartureTime
        );
    },

    findPassAtStop: function(passIndex, timingPointCode, pass, allowedLines = null) {
        const stopPasses = passIndex.continuation[timingPointCode];
        if (!stopPasses)
            return null;

        const possibleMatches = stopPasses[this.buildContinuationKey(pass)];
        if (!possibleMatches || possibleMatches.length === 0)
            return null;

        if (!allowedLines || allowedLines.length === 0)
            return possibleMatches[0];

        return possibleMatches.find((candidate) =>
            allowedLines.includes(String(candidate.LinePublicNumber))
        ) || null;
    },

    isChronologicalContinuation: function(originPass, transferDeparturePass, destinationPass) {
        const originTime = this.getPassDateTime(originPass);
        const transferDepartureTime = this.getPassDateTime(transferDeparturePass);
        const destinationTime = this.getPassDateTime(destinationPass);

        if (Number.isNaN(originTime.getTime()) ||
            Number.isNaN(transferDepartureTime.getTime()) ||
            Number.isNaN(destinationTime.getTime())) {
            return false;
        }

        return transferDepartureTime.getTime() >= originTime.getTime() &&
            destinationTime.getTime() >= transferDepartureTime.getTime();
    },

    findContinuationViaTransferStop: function(pass, combinedRouteRule, passIndex, preferredDestinationCode) {
        const originTransferTimingPointCode =
            combinedRouteRule.viaOriginTimingPointCode ||
            combinedRouteRule.viaTimingPointCode;
        const continuationTransferTimingPointCode =
            combinedRouteRule.viaContinuationTimingPointCode ||
            combinedRouteRule.viaTimingPointCode;

        if (!originTransferTimingPointCode || !continuationTransferTimingPointCode)
            return null;

        const originViaPass = this.findPassAtStop(
            passIndex,
            originTransferTimingPointCode,
            pass,
            [String(pass.LinePublicNumber)]
        );
        if (!originViaPass)
            return null;

        const originArrivalAtVia = this.getPassDateTime(originViaPass);
        if (!(originArrivalAtVia instanceof Date) || Number.isNaN(originArrivalAtVia.getTime()))
            return null;

        const transferStopPasses = passIndex.continuation[continuationTransferTimingPointCode];
        if (!transferStopPasses)
            return null;

        const maxTransferTime = originArrivalAtVia.getTime() + (combinedRouteRule.maxTransferMinutes * 60 * 1000);
        const continuationCandidates = [];

        for (const passList of Object.values(transferStopPasses)) {
            for (const candidate of passList) {
                if (String(candidate.DataOwnerCode || "") !== String(pass.DataOwnerCode || ""))
                    continue;
                if (String(candidate.OperationDate || "") !== String(pass.OperationDate || ""))
                    continue;
                if (!combinedRouteRule.lines.includes(String(candidate.LinePublicNumber)))
                    continue;

                const candidateTime = this.getPassDateTime(candidate);
                if (!(candidateTime instanceof Date) || Number.isNaN(candidateTime.getTime()))
                    continue;
                if (candidateTime.getTime() < originArrivalAtVia.getTime())
                    continue;
                if (candidateTime.getTime() > maxTransferTime)
                    continue;

                continuationCandidates.push(candidate);
            }
        }

        continuationCandidates.sort((left, right) => this.getPassDateTime(left) - this.getPassDateTime(right));
        const offsetCandidates = continuationCandidates.slice(combinedRouteRule.offsetDepartures || 0);

        for (const followUpDeparture of offsetCandidates) {
            const destinationPass = this.findPassAtStop(
                passIndex,
                preferredDestinationCode,
                followUpDeparture,
                combinedRouteRule.lines
            );
            if (!destinationPass)
                continue;
            if (!this.isChronologicalContinuation(originViaPass, followUpDeparture, destinationPass))
                continue;

            return {
                destinationPass: destinationPass,
                transferArrivalPass: originViaPass,
                transferDeparturePass: followUpDeparture
            };
        }

        return null;
    },

    findPreferredDestinationPass: function(pass, preferredDestinationCode, passIndex, config) {
        if (!preferredDestinationCode)
            return null;

        const exactPasses = passIndex.exact[preferredDestinationCode];
        const exactMatch = exactPasses && exactPasses[this.buildJourneyKey(pass)];
        if (exactMatch)
            return {
                destinationPass: exactMatch,
                transferArrivalPass: null,
                transferDeparturePass: null
            };

        const combinedRouteRule = this.getCombinedRouteRule(config, pass.LinePublicNumber);
        if (combinedRouteRule.lines.length === 0)
            return null;

        const continuationPasses = passIndex.continuation[preferredDestinationCode];
        const possibleMatches = continuationPasses &&
            continuationPasses[this.buildContinuationKey(pass)];
        if (possibleMatches && possibleMatches.length > 0) {
            const sameJourneyContinuation = possibleMatches.find((candidate) =>
                combinedRouteRule.lines.includes(String(candidate.LinePublicNumber))
            );
            if (sameJourneyContinuation)
                return {
                    destinationPass: sameJourneyContinuation,
                    transferArrivalPass: null,
                    transferDeparturePass: null
                };
        }

        return this.findContinuationViaTransferStop(
            pass,
            combinedRouteRule,
            passIndex,
            preferredDestinationCode
        );
    },

    enrichPreferredDestination: function(pass, preferredDestinationMatch) {
        if (!preferredDestinationMatch || !preferredDestinationMatch.destinationPass)
            return null;

        const preferredDestinationPass = preferredDestinationMatch.destinationPass;

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
            TravelDurationMinutes: travelDurationMinutes,
            TransferArrivalTime: preferredDestinationMatch.transferArrivalPass ?
                this.getPassDateTime(preferredDestinationMatch.transferArrivalPass).toISOString() :
                null,
            TransferDepartureTime: preferredDestinationMatch.transferDeparturePass ?
                this.getPassDateTime(preferredDestinationMatch.transferDeparturePass).toISOString() :
                null,
            TransferTimingPointName: preferredDestinationMatch.transferArrivalPass ?
                (preferredDestinationMatch.transferArrivalPass.TimingPointName || preferredDestinationMatch.transferArrivalPass.UserStopCode) :
                null
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
        const routeOrderByOriginCode = {};
        const routeSkipByOriginCode = {};
        const allowedOriginLines = Array.isArray(config.originLineNumbers) ?
            config.originLineNumbers.map((line) => String(line)) :
            [];

        for (const [index, routeEntry] of routeEntries.entries()) {
            routeByOriginCode[routeEntry.originTimingPointCode] = routeEntry;
            routeOrderByOriginCode[routeEntry.originTimingPointCode] = index;
            routeSkipByOriginCode[routeEntry.originTimingPointCode] =
                Number.isInteger(config.skipDepartures && config.skipDepartures[routeEntry.originTimingPointCode]) ?
                    Math.max(0, config.skipDepartures[routeEntry.originTimingPointCode]) :
                    0;
        }

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

            if (!departures[timingPointName]) {
                departures[timingPointName] = [];
                departures[timingPointName].ConfiguredSkipDepartures =
                    routeSkipByOriginCode[Stop.TimingPointCode] || 0;
            }

            for (const pass of Object.values(Passes)) {
                const destination = pass.DestinationName50 || "?";
                const operator = pass.OperatorCode || pass.DataOwnerCode || "?";
                const routeEntry = routeByOriginCode[pass.TimingPointCode] || {};
                const routeOrder = routeOrderByOriginCode[pass.TimingPointCode];
                const preferredDestinationCode = routeEntry.preferredDestinationTimingPointCode;
                const preferredDestinationMatch = this.findPreferredDestinationPass(
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

                if (allowedOriginLines.length > 0 &&
                    !allowedOriginLines.includes(String(pass.LinePublicNumber))) {
                    if (debug)
                        console.log(this.name + ": Skipped line " + pass.LinePublicNumber +
                            " because it is not in originLineNumbers");
                    continue;
                }

                if (preferredDestinationCode && !preferredDestinationMatch) {
                    if (debug)
                        console.log(this.name + ": Skipped line " + pass.LinePublicNumber +
                            " because it does not reach timing point " + preferredDestinationCode);
                    continue;
                }

                const wheelchairAccessible = (pass.WheelChairAccessible == "ACCESSIBLE") ? 1 : 0;
                const preferredDestination = this.enrichPreferredDestination(pass, preferredDestinationMatch);
                const preferredDestinationPass = preferredDestinationMatch ?
                    preferredDestinationMatch.destinationPass :
                    null;

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
                    PreferredDestinationLinePublicNumber: preferredDestinationPass ? preferredDestinationPass.LinePublicNumber : null,
                    TransferArrivalTime: preferredDestination ? preferredDestination.TransferArrivalTime : null,
                    TransferDepartureTime: preferredDestination ? preferredDestination.TransferDepartureTime : null,
                    TransferTimingPointName: preferredDestination ? preferredDestination.TransferTimingPointName : null,
                    ConfiguredStopOrder: Number.isInteger(routeOrder) ? routeOrder : Number.MAX_SAFE_INTEGER
                });
            }

            // If we filtered out all departures for this stop, remove stop
            // itself too.
            if (departures[timingPointName].length == 0)
                delete departures[timingPointName];
        }
	//console.log(departures);
        // Sort departures by time, per timingpoint.
        for (const departureList of Object.values(departures)) {
            departureList.sort(
                (obj1, obj2) => obj1["ExpectedDepartureTime"].localeCompare(
                    obj2["ExpectedDepartureTime"]));
            const skipCount = departureList.ConfiguredSkipDepartures || 0;
            if (skipCount > 0)
                departureList.splice(0, skipCount);
        }

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
        const transferTimingPointCodes = [...new Set(Object.values(config.combinedRoutes || {})
            .flatMap((rule) => {
                if (rule && typeof rule === "object" && !Array.isArray(rule)) {
                    return [
                        rule.viaTimingPointCode || rule.via || null,
                        rule.viaOriginTimingPointCode || rule.viaFromTimingPointCode || rule.viaOrigin || null,
                        rule.viaContinuationTimingPointCode || rule.viaToTimingPointCode || rule.viaContinuation || null
                    ];
                }
                return [];
            })
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
        const fetchTransferTimingPoints = this.fetchData(
            config,
            config.timingPointEndpoint,
            transferTimingPointCodes.join(","),
            false
        );

        Promise.all([fetchTimingPoints, fetchStopAreas, fetchPreferredDestinations, fetchTransferTimingPoints])
        .then(([timingPointData, stopAreaData, preferredDestinationData, transferTimingPointData]) => ({
            data: this.mergeData(timingPointData, stopAreaData),
            preferredDestinationData: Object.assign({}, preferredDestinationData, transferTimingPointData)
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
