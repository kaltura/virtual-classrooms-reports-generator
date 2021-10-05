const axios = require("axios");
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

const { sendHttpRequest, generateCsvFile, convertDateStrToRightTimeZone, httpsRequest} = require('./utils');

function getAuthorizationHeader(consumer, requestData){
    const oauth = OAuth({
        consumer: consumer,
        signature_method: 'HMAC-SHA1',
        hash_function(base_string, key) {
            return crypto
                .createHmac('sha1', key)
                .update(base_string)
                .digest('base64')
        },
    })
    return oauth.toHeader(oauth.authorize(requestData));
}

async function getNewrowBearerToken(webserverApi, ltiKey, ltiSecret){
    const consumer = {
        key: ltiKey,
        secret: ltiSecret,
    }
    const requestData = {
        url: webserverApi + "api/auth/login",
        method: 'POST',
    }
    const authHeader = getAuthorizationHeader(consumer, requestData);
    const requestConfig = {
        headers: authHeader
    }
    let result = null;
    try {
        result = await axios.post(requestData.url, {}, requestConfig);
        if (result && result.data && result.data.status === 'success' && result.data.data) {
            return result.data.data;
        }
    }
    catch (e) {
        // do nothing
    }
    return result;
}

async function sendNewrowAPIRequest(webserverApi, requestUri, bearerToken, method = 'GET', params = {}){
    const url = `${webserverApi}api/${requestUri}`;
    const requestConfig = {
        headers: {
            Authorization: "Bearer " + bearerToken
        },
        timeout: 5000,
    }
    let result;
    try {
        result = await sendHttpRequest(url, method, params, requestConfig);
        if (result && result.data && result.data.status === 'success' && result.data.data) {
            return result.data.data;
        }
    }
    catch (e) {
        // do nothing
    }
    console.error('Newrow API request failed', {url, method, params});
}

async function sendNewrowAdminRequest(webserverApi, requestUri, adminToken, method = 'GET', params = {}){
    let url = `${webserverApi}/admin/${requestUri}`;
    let fixedParams = params;
    if (method === 'GET'){
        fixedParams = Object.assign({}, fixedParams, {'access-token': adminToken});
    }
    else if (method === 'POST'){
        url = `${url}?access-token=${adminToken}`;
    }
    return await sendHttpRequest(url, method, fixedParams);
}

async function sendHttpRequestToMS(msGatewayUrl, uri, method = 'GET', params = {}) {
    const url = `${msGatewayUrl}${uri}`;
    let urlParams = {};
    let bodyParams = {};
    let headers = {};
    if (method === 'GET') {
        urlParams = params;
    } else if (method === 'POST') {
        bodyParams = params;
        headers = { 'content-type': 'application/json' };
    }
    const requestConfig = {
        method,
        url,
        params: urlParams,
        data: bodyParams,
        headers,
    };
    return await sendHttpRequest(requestConfig);
}

async function getRoomSessionsBetweenDates(webserverApi, bearerToken, roomId, fromDate, toDate){
    let params = {
        "room_id": roomId,
        "from_date": fromDate,
        "to_date": toDate,
    }
    const res = await sendNewrowAPIRequest(webserverApi, 'analytics/sessions', bearerToken, 'GET', params);
    return res && res["sessions"] ? res["sessions"] : null;
}

async function getCompanySessionsBetweenDates(webserverApi, bearerToken, fromDate, toDate){
    let params = {
        "from_date": fromDate,
        "to_date": toDate,
        "limit": 1000,
    }
    const res = await sendNewrowAPIRequest(webserverApi, 'analytics/sessions', bearerToken, 'GET', params);
    return res && res["sessions"] ? res["sessions"] : null;
}

async function getSessionParticipantsData(webserverApi, bearerToken, sessionId, params = {}){
    params = Object.assign({}, params, { limit: 1000});
    const res = await sendNewrowAPIRequest(webserverApi, `analytics/detailed-session-attendees/${sessionId}`, bearerToken, 'GET', params);
    return res && res["detailed_attendance"] ? res["detailed_attendance"] : null;
}

async function getRoomName(webserverApi, bearerToken, roomId){
    const res = await sendNewrowAPIRequest(webserverApi, `rooms/${roomId}`, bearerToken, 'GET');
    return res && res["name"] ? res["name"] : null;
}

function parseSingleSessionData(sessionDataStr, fields){
    const res = {};
    let prevIndex, currIndex = 0;
    for (let i=0; i<fields.length; i++){
        const fieldName = fields[i];
        let finished = false, ignoreComma = false;
        prevIndex = currIndex;
        while (currIndex < sessionDataStr.length && !finished){
             if (sessionDataStr[currIndex] === '\"'){
                if (!ignoreComma){
                    ignoreComma = true;
                }
                else {
                    finished = true;
                }
            }
            else if (sessionDataStr[currIndex] === ',' && !ignoreComma && currIndex > prevIndex){
                finished = true;
            }
            if (finished){
                while (sessionDataStr[prevIndex] === '\"' || sessionDataStr[prevIndex] === ','){
                    prevIndex++;
                }
                if (currIndex > prevIndex) {
                    res[fieldName] = sessionDataStr.substring(prevIndex, currIndex);
                }
            }
            currIndex++;
        }
        if (i === fields.length-1) {
            while (prevIndex < sessionDataStr.length && (sessionDataStr[prevIndex] === '\"' || sessionDataStr[prevIndex] === ',')) {
                prevIndex++;
            }
            if (currIndex >= prevIndex) {
                res[fieldName] = sessionDataStr.substring(prevIndex, currIndex);
            }
        }
    }
    return res;
}

async function generateCompanyAggregatedReport(webserverApi, adminToken, companyId, overrideRoomsIds = [], fromDate, toDate, timeZone, outputPath){
    const params = {
        "company_id": companyId,
        "start_date": fromDate,
        "end_date": toDate,
    };
    const response = await sendNewrowAdminRequest(webserverApi, 'dashboard/exportSessionsDataReport', adminToken, 'POST', params);
    const lines = response.data.split(/\r?\n/);
    const fields = lines[0].split(",");
    let records = lines.splice(1);
    records = records.filter((record) => record.length >= fields.length);
    records = records.map((record) => parseSingleSessionData(record, fields));
    records.forEach((record) => {
        record["start_date"] = convertDateStrToRightTimeZone(record["start_date"], timeZone);
        record["end_date"] = convertDateStrToRightTimeZone(record["end_date"], timeZone);
    })
    if (overrideRoomsIds.length > 0){
        // Filter out non relevant rooms ids
        records = records.filter((record) => overrideRoomsIds.includes(parseInt(record["room_id"])), records);
    }
    const fixedFields = [];
    for (const field of fields){
        fixedFields.push({id: field, title: field});
    }
    const contentDisposition = response.headers['content-disposition'];
    let fileName = 'unknown.csv';
    if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename="(.+)"/);
        if (fileNameMatch.length === 2)
            fileName = fileNameMatch[1];
    }
    const outputFilePath = `${outputPath}/${fileName}`;
    await generateCsvFile(outputFilePath, fixedFields, records);
}

async function getRoomChatMessages(msGatewayUrl, companyId, roomId, type, startDate, endDate){
    const requestData = JSON.stringify({type, start_date: startDate * 1000, end_date: endDate * 1000});

    const options = {
        hostname: msGatewayUrl,
        path: `/chat/conversations/messages/history/company/${companyId}/room/${roomId}`,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestData)
        }
    };

    const res = await httpsRequest(options, requestData);
    if (res && res.data && res.data.payload && res.data.payload.messages){
        return res.data.payload.messages;
    }
    return [];
}

module.exports = { getNewrowBearerToken, getRoomSessionsBetweenDates, getSessionParticipantsData,
    getCompanySessionsBetweenDates, generateCompanyAggregatedReport, getRoomChatMessages }
