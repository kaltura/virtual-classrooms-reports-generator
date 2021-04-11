const axios = require("axios");
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

const { sendHttpRequest, generateCsvFile, convertDateStrToRightTimeZone } = require('./utils');

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
    return new Promise(async (resolve, reject) => {
        const result = await axios.post(requestData.url, {}, requestConfig);
        if (result && result.data && result.data.status === 'success' && result.data.data) {
            resolve(result.data.data);
        } else {
            reject(result);
        }
    })
}

async function sendNewrowAPIRequest(webserverApi, requestUri, bearerToken, method = 'GET', params = {}){
    const url = `${webserverApi}api/${requestUri}`;
    const requestConfig = {
        headers: {
            Authorization: "Bearer " + bearerToken
        }
    }
    return new Promise(async (resolve, reject) => {
        const result = await sendHttpRequest(url, method, params, requestConfig);
        if (result && result.data && result.data.status === 'success' && result.data.data){
            resolve(result.data.data);
        }
        else{
            reject(result);
        }
    })
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

async function getRoomSessionsBetweenDates(webserverApi, bearerToken, roomId, fromDate, toDate){
    let params = {
        "room_id": roomId,
        "from_date": fromDate,
        "to_date": toDate,
    }
    return await sendNewrowAPIRequest(webserverApi, 'analytics/sessions', bearerToken, 'GET', params);
}

async function getSessionParticipantsData(webserverApi, bearerToken, sessionId, params = {}){
    const res = await sendNewrowAPIRequest(webserverApi, `analytics/detailed-session-attendees/${sessionId}`, bearerToken, 'GET', params);
    return res["detailed_attendance"];
}

async function getRoomName(webserverApi, bearerToken, roomId){
    const res = await sendNewrowAPIRequest(webserverApi, `rooms/${roomId}`, bearerToken, 'GET');
    return res["name"];
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

async function generateCompanyReport(webserverApi, adminToken, companyId, fromDate, toDate, timeZone, outputPath){
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

module.exports = { getNewrowBearerToken, getRoomSessionsBetweenDates, getSessionParticipantsData, getRoomName, generateCompanyReport }
