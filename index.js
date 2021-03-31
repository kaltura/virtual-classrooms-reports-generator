const config = require("config");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const { getNewrowBearerToken, getRoomSessionsBetweenDates, getSessionParticipantsData, getRoomName } = require('./src/NewrowHelper');
const { generateKS, getKalturaUsersRegistrationInfo } = require('./src/KalturaHelper');
const { generateZipFile, convertMillisecondsToDateTime } = require('./src/utils');

const webserverApi = config.get("newrow.webserver_api");
const ltiKey = config.get("newrow.lti_key");
const ltiSecret = config.get("newrow.lti_secret");
const roomsIds = config.get("newrow.rooms_ids");

const partnerId = config.get("kaltura.partner_id");
const secret = config.get("kaltura.admin_secret");

const fromDate = config.get("report_start_time");
const toDate = config.get("report_end_time");
const outputFolderPath = config.get("output_path");

const roomReportFieldNames = [
    {id: 'kuserId', title: 'Kaltura User ID'},
    {id: 'firstName', title: 'First Name'},
    {id: 'lastName', title: 'Last Name'},
    {id: 'email', title: 'Email'},
    {id: 'title', title: 'Title'},
    {id: 'company', title: 'Company'},
    {id: 'country', title: 'Country'},
    {id: 'city', title: 'City'},
    {id: 'state', title: 'State'},
    {id: 'postalCode', title: 'Postal Code'},
    {id: 'jobRole', title: 'Job Role'},
    {id: 'joined', title: 'Joined'},
    {id: 'left', title: 'Left'},
    {id: 'duration', title: 'Duration'},
    {id: 'attention', title: 'Attention'},
];

function checkIfShouldAddUserToReport(userRegistrationInfo){
    let shouldIncludeUser = userRegistrationInfo["email"].includes("amazon");
    shouldIncludeUser &= userRegistrationInfo.hasOwnProperty("connectWithPartners") && userRegistrationInfo["connectWithPartners"] === "true";
    shouldIncludeUser &= (userRegistrationInfo["country"] !== 'HK');
    return shouldIncludeUser;
}

async function getAllUsersDataFromASingleSession(session, bearerToken, ks){
    const res = [];
    return new Promise(async (resolve) => {
        const newrowParticipantsData = await getSessionParticipantsData(webserverApi, bearerToken, session["id"]);
        const kalturaUsersIds = newrowParticipantsData.map((participant) => participant["tp_user_id"]);
        const kalturaUsersRegistrationInfo = await getKalturaUsersRegistrationInfo(ks, kalturaUsersIds);
        newrowParticipantsData.forEach((participant) => {
            const kUserId = participant["tp_user_id"];
            if (kalturaUsersRegistrationInfo[kUserId]){
                const registrationInfo = kalturaUsersRegistrationInfo[kUserId];
                if (checkIfShouldAddUserToReport(registrationInfo)){
                    res.push({
                        "kuserId": participant["tp_user_id"],
                        "firstName": registrationInfo["firstName"],
                        "lastName": registrationInfo["lastName"],
                        "email": registrationInfo,
                        "title": registrationInfo["title"],
                        "company": registrationInfo["company"],
                        "country": registrationInfo["country"],
                        "city": registrationInfo["city"],
                        "state": registrationInfo["state"],
                        "postalCode": registrationInfo["postalCode"],
                        "jobRole": registrationInfo["jobRole"],
                        "joined": convertMillisecondsToDateTime(participant["time_joined"]),
                        "left": convertMillisecondsToDateTime(participant["time_left"]),
                        "duration": participant["time_left"] - participant["time_joined"],
                        "attention": participant["focus_time"],
                    })
                }
            }
        })
        resolve(res);
    })
}

async function collectParticipantsDataFromAllSessions(sessions, bearerToken, ks){
    const res = [];
    return new Promise((resolve) => {
        const sessionsDataPromises = sessions.map(session => getAllUsersDataFromASingleSession(session, bearerToken, ks));
        Promise.all(sessionsDataPromises).then((sessionsData) => {
            sessionsData.forEach(sessionData => {
                res.concat(sessionData);
            })
            resolve(res);
        })
    })
}

async function generateCsvFile(outputFilePath, fieldNames, records){
    return new Promise(async resolve => {
        const csvWriter = createCsvWriter({
            path: outputFilePath,
            header: fieldNames,
        })
        await csvWriter.writeRecords(records);
        resolve(true);
    })
}

async function generateRoomReport(roomId, fromDate, toDate, bearerToken, ks){
    return new Promise(async (resolve, reject) => {
        try {
            const roomName = await getRoomName(webserverApi, bearerToken, roomId);
            const result = await getRoomSessionsBetweenDates(webserverApi, bearerToken, roomId, fromDate, toDate);
            const sessionParticipantsData = await collectParticipantsDataFromAllSessions(result["sessions"], bearerToken, ks);
            const fileName = `${roomName}_${fromDate}_${toDate}.csv`;
            await generateCsvFile(`${outputFolderPath}/${fileName}`, roomReportFieldNames, sessionParticipantsData);
            resolve(true);
        }
        catch (e) {
            console.error('Something went wrong', e);
            reject(e);
        }
    })
}

(async () => {
    try{
        let bearerToken = await getNewrowBearerToken(webserverApi, ltiKey, ltiSecret);
        bearerToken = bearerToken["token"];
        const ks = generateKS(partnerId, secret);
        const roomsReportsPromises = roomsIds.map(id => generateRoomReport(id, fromDate, toDate, bearerToken, ks));
        Promise.all(roomsReportsPromises).then((values) => {
            console.log("Finished collecting data");
            const zipFileName = `${outputFolderPath}/SKO_${fromDate}_${toDate}.zip`;
            generateZipFile(outputFolderPath, zipFileName).then(() => {
                console.log("Finished creating zip file");
            }).catch(error => {
                console.error(error.message);
            })
        })
    }
    catch (e){
        console.log(e.message);
    }
})();


