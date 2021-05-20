const crypto = require('crypto');
const qs = require('querystring');

const sendHttpRequest = require('./utils').sendHttpRequest;

function hash(buf) {
    let sha1 = crypto.createHash('sha1');
    sha1.update(buf);
    return sha1.digest();
}

function generateKS(partnerId, secret){
    let now = new Date();

    const ksDuration = 12 * 60 * 60; //12 hours
    // build fields array
    let fields = {};
    fields._e = Math.round(now.getTime() / 1000) + ksDuration ;
    fields._t = 2;
    fields._u = "admin";

    let fieldsStr = qs.stringify(fields);

    let fieldsBuf = Buffer.from(fieldsStr);

    let rnd = Buffer.from(crypto.randomBytes(16));

    fieldsBuf = Buffer.concat([rnd, fieldsBuf]);

    let sha1Buf = hash(fieldsBuf);

    let message = Buffer.concat([sha1Buf, fieldsBuf]);

    if (message.length % 16) {
        let padding = Buffer.alloc(16 - message.length % 16, 0, 'binary');
        message = Buffer.concat([message, padding]);
    }

    let iv = Buffer.alloc(16, 0, 'binary');
    let key = hash(secret).slice(0, 16);
    let cipher = crypto.createCipheriv("aes-128-cbc", key, iv);

    cipher.setAutoPadding(false);

    let ciphertext = cipher.update(message);

    let header = 'v2|' + partnerId + '|';
    let $decodedKs = Buffer.concat([Buffer.from(header), Buffer.from(ciphertext)]).toString('base64');

    return $decodedKs.split('+').join('-').split('/').join('_');
}

async function getKalturaUsersList(apiServerHost, ks, kalturaUsersIds){
    const params = {
        format: 1,
        ks: ks,
        service: "user",
        action: "list",
        "filter:objectType": "KalturaUserFilter",
        "filter:idIn": kalturaUsersIds.join(","),
        "pager:pageSize": kalturaUsersIds.length,
    }
    const config = { timeout: 5000 };
    try {
        const result = await sendHttpRequest(apiServerHost, 'POST', params, config);
        if (result && result.status === 200 && result.data && result.data.objects) {
            return result.data.objects;
        }
    } catch (e) {
        console.log('Kaltura API request failed', e);
        return null;
    }
}

async function getKalturaUserData(apiServerHost, ks, kalturaUserId){
    const params = {
        format: 1,
        ks: ks,
        service: "user",
        action: "get",
        userId: kalturaUserId,
    }
    try {
        const result = await sendHttpRequest(apiServerHost, 'POST', params);
        if (result && result.status === 200 && result.data) {
            return result.data;
        }
    }
    catch (e) {
        throw new Error(e.message);
    }
}

async function getKalturaUsersRegistrationInfo(apiServerHost, ks, kalturaUsersIds){
    const res = {};
    const usersData = await getKalturaUsersList(apiServerHost, ks, kalturaUsersIds);
    if (usersData) {
        for (const userData of usersData) {
            if (userData["id"] && userData["registrationInfo"]) {
                res[userData["id"]] = JSON.parse(userData["registrationInfo"]);
            }
        }
    }
    return res;
}

module.exports = { generateKS, getKalturaUsersRegistrationInfo }
