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

async function getKalturaUsersList(ks, kalturaUsersIds){
    const params = {
        format: 1,
        ks: ks,
        service: "user",
        action: "list",
        "filter:objectType": "KalturaUserFilter",
        "filter:idIn": kalturaUsersIds.join(","),
        "pager:pageSize": kalturaUsersIds.length,
    }
    return new Promise(async (resolve, reject) => {
        const result = await sendHttpRequest("https://www.kaltura.com/api_v3/index.php", 'GET', params);
        if (result && result.status === 200 && result.data && result.data.objects){
            resolve(result.data.objects);
        }
        console.log("Kaltura API failed: %s", JSON.stringify(result));
        reject(result);
    });
}

async function getKalturaUserData(ks, kalturaUserId){
    const params = {
        format: 1,
        ks: ks,
        service: "user",
        action: "get",
        userId: kalturaUserId,
    }
    return new Promise(async (resolve, reject) => {
        const result = await sendHttpRequest("https://www.kaltura.com/api_v3/index.php", 'GET', params);
        if (result && result.status === 200 && result.data){
            resolve(result.data);
        }
        console.log("Kaltura API failed", result);
        reject(result);
    });
}

async function getKalturaUsersRegistrationInfo(ks, kalturaUsersIds){
    /*
    const kalturaUsersIds = sessionAttendance.map((participantData) => participantData["tp_user_id"]);
    const kalturaUsersData = await getKalturaUsersList(kalturaUsersIds);
    console.log("Session [%d] has [%d] registered users at Kaltura", sessionId, kalturaUsersData.length);
    const kalturaUsersMapping = {};
    kalturaUsersData.forEach((kalturaUserData) =>{
        kalturaUsersMapping[kalturaUserData["id"]] = kalturaUserData;
    })
    */
    const res = {};
    return new Promise(async resolve => {
        const promises = kalturaUsersIds.map((userId) => getKalturaUserData(ks, userId));
        Promise.all(promises).then((usersData) => {
            usersData.forEach((userData) => {
                const parsedUserData = JSON.parse(userData);
                res[parsedUserData["id"]] = parsedUserData;
            })
            resolve(res);
        })

    });
}

module.exports = { generateKS, getKalturaUsersList, getKalturaUserData, getKalturaUsersRegistrationInfo }
