const config = require("config");

const { getNewrowBearerToken, getRoomSessionsBetweenDates, getSessionParticipantsData, getRoomName, generateCompanyReport } = require('./src/NewrowHelper');
const { generateKS, getKalturaUsersRegistrationInfo } = require('./src/KalturaHelper');
const { generateZipFile, convertMillisecondsToDateTime, generateCsvFile } = require('./src/utils');

const newrowWebserverApi = config.get("newrow.webserver_api");
const ltiKey = config.get("newrow.lti_key");
const ltiSecret = config.get("newrow.lti_secret");
const companyId = config.get("newrow.company_id");
const roomsIds = config.get("newrow.rooms_ids");
const adminToken = config.get("newrow.admin_token");

const kalturaApiServerHost = config.get("kaltura.api_server_host");
const partnerId = config.get("kaltura.partner_id");
const secret = config.get("kaltura.admin_secret");

const fromDate = config.get("report_start_time");
const toDate = config.get("report_end_time");
const timeZone = config.get("report_time_zone");
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
    /*
    let shouldIncludeUser = userRegistrationInfo["email"].includes("amazon");
    shouldIncludeUser &= userRegistrationInfo.hasOwnProperty("connectWithPartners") && userRegistrationInfo["connectWithPartners"] === "true";
    //shouldIncludeUser &= (userRegistrationInfo["country"] !== 'HK');
    return shouldIncludeUser;
     */
    return true;
}

async function getAllUsersDataFromASingleSession(session, bearerToken, ks){
    const res = [];
    let newrowParticipantsData = await getSessionParticipantsData(newrowWebserverApi, bearerToken, session["id"]);
    newrowParticipantsData = newrowParticipantsData.filter((participant) => participant.hasOwnProperty("tp_user_id"));
    const kalturaUsersIds = newrowParticipantsData.map((participant) => participant["tp_user_id"]);
    const kalturaUsersRegistrationInfo = await getKalturaUsersRegistrationInfo(kalturaApiServerHost, ks, kalturaUsersIds);
    for (const participant of newrowParticipantsData){
        const kUserId = participant["tp_user_id"];
        if (kalturaUsersRegistrationInfo[kUserId]){
            const registrationInfo = kalturaUsersRegistrationInfo[kUserId];
            if (checkIfShouldAddUserToReport(registrationInfo)){
                res.push({
                    "kuserId": participant["tp_user_id"],
                    "firstName": registrationInfo["firstName"],
                    "lastName": registrationInfo["lastName"],
                    "email": registrationInfo["email"],
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
    }
    return res;
}

async function collectParticipantsDataFromAllSessions(sessions, bearerToken, ks){
    let res = [];
    const sessionsDataPromises = sessions.map(session => getAllUsersDataFromASingleSession(session, bearerToken, ks));
    const sessionsData = await Promise.all(sessionsDataPromises);
    for (const sessionData of sessionsData){
        res = res.concat(sessionData);
    }
    return res;
}

async function generateRoomReport(roomId, fromDate, toDate, bearerToken, ks){
    const roomName = await getRoomName(newrowWebserverApi, bearerToken, roomId);
    const result = await getRoomSessionsBetweenDates(newrowWebserverApi, bearerToken, roomId, fromDate, toDate);
    const sessionParticipantsData = await collectParticipantsDataFromAllSessions(result["sessions"], bearerToken, ks);
    const fileName = `${roomName}_${fromDate}_${toDate}.csv`;
    await generateCsvFile(`${outputFolderPath}/${fileName}`, roomReportFieldNames, sessionParticipantsData);
}

(async () => {
    try{
        let bearerToken = await getNewrowBearerToken(newrowWebserverApi, ltiKey, ltiSecret);
        bearerToken = bearerToken["token"];
        const ks = generateKS(partnerId, secret);
        await generateCompanyReport(newrowWebserverApi, adminToken, companyId, fromDate, toDate, timeZone, outputFolderPath);
        console.log("Finished generating company report");
        const roomsReportsPromises = roomsIds.map(id => generateRoomReport(id, fromDate, toDate, bearerToken, ks));
        await Promise.all(roomsReportsPromises);
        console.log("Finished collecting data");
        const zipFileName = `${outputFolderPath}/Company_${companyId}_Report_${fromDate}_${toDate}.zip`;
        await generateZipFile(outputFolderPath, zipFileName);
        console.log("Finished creating zip file");
    }
    catch (e){
        console.log(e.message);
    }
})();


