const axios = require("axios");
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

const sendHttpRequest = require('./utils').sendHttpRequest;

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
        url: webserverApi + "backend/api/auth/login",
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

async function sendNewrowAPIRequest(url, bearerToken, method = 'GET', params = {}){
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

function getRoomSessionsBetweenDates(webserverApi, bearerToken, roomId, fromDate, toDate){
    let params = {
        "room_id": roomId,
        "from_date": fromDate,
        "to_date": toDate,
    }
    return new Promise(async resolve => {
        const res = await sendNewrowAPIRequest(`${webserverApi}backend/api/analytics/sessions`, bearerToken, 'GET' ,params);
        resolve(res);
    })
}

async function getSessionParticipantsData(webserverApi, bearerToken, sessionId, params = {}){
    return new Promise(async resolve => {
        const res = await sendNewrowAPIRequest(`${webserverApi}backend/api/analytics/detailed-session-attendees/${sessionId}`, bearerToken, 'GET', params);
        resolve(res["detailed_attendance"]);
    })
}

async function getRoomName(webserverApi, bearerToken, roomId){
    return new Promise(async resolve => {
        const res = await sendNewrowAPIRequest(`${webserverApi}backend/api/rooms/${roomId}`, bearerToken, 'GET');
        resolve(res["name"])
    })
}

module.exports = { getNewrowBearerToken, getRoomSessionsBetweenDates, getSessionParticipantsData, getRoomName }
