const config = require("config");

const { getNewrowBearerToken, getRoomSessionsBetweenDates, getSessionParticipantsData, getCompanySessionsBetweenDates } = require('./src/NewrowHelper');
const { generateKS, getKalturaUsersRegistrationInfo } = require('./src/KalturaHelper');
const { generateZipFile, convertMillisecondsToDateTime, generateCsvFile } = require('./src/utils');

const newrowWebserverApi = config.get("newrow.webserver_api");
const ltiKey = config.get("newrow.lti_key");
const ltiSecret = config.get("newrow.lti_secret");
const companyId = config.get("newrow.company_id");
const overrideRoomsIds = config.get("newrow.override_rooms_ids");

const kalturaApiServerHost = config.get("kaltura.api_server_host");
const partnerId = config.get("kaltura.partner_id");
const secret = config.get("kaltura.admin_secret");

const fromDate = config.get("report_start_time");
const toDate = config.get("report_end_time");
const outputFolderPath = config.get("output_path");

const roomReportFieldNames = [
    {id: 'roomName', title: 'Room Name'},
    {id: 'ltiRoomId', title: 'Entry ID'},
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
    {id: 'phone', title: 'Phone Number'},
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
    return shouldIncludeUser;
     */
    return true;
}

async function getAllUsersDataFromASingleSession(session, bearerToken, ks){
    const res = [];
    const roomId = session["room_id"];
    const ltiRoomId = session["third_party_room_id"];
    const sessionId = session["id"];
    console.log(`Collecting participants data for room ${roomId} and session ${sessionId}`);
    let newrowParticipantsData = await getSessionParticipantsData(newrowWebserverApi, bearerToken, session["id"]);
    if (newrowParticipantsData && newrowParticipantsData.length >= 1) {
        newrowParticipantsData = newrowParticipantsData.filter((participant) => participant.hasOwnProperty("tp_user_id"));
        if (newrowParticipantsData.length > 0) {
            const kalturaUsersIds = newrowParticipantsData.map((participant) => participant["tp_user_id"]);
            console.log(`Getting Kaltura users registration info for room ${roomId} and session ${sessionId}`);
            const kalturaUsersRegistrationInfo = await getKalturaUsersRegistrationInfo(kalturaApiServerHost, ks, kalturaUsersIds);
            if (kalturaUsersRegistrationInfo) {
                const roomName = session["room_name"];
                for (const participant of newrowParticipantsData) {
                    const kUserId = participant["tp_user_id"];
                    if (kalturaUsersRegistrationInfo[kUserId]) {
                        const registrationInfo = kalturaUsersRegistrationInfo[kUserId];
                        if (checkIfShouldAddUserToReport(registrationInfo)) {
                            res.push({
                                "roomName": roomName,
                                "ltiRoomId": ltiRoomId,
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
                                "phone": registrationInfo["phone"],
                                "jobRole": registrationInfo["jobRole"],
                                "joined": convertMillisecondsToDateTime(participant["time_joined"] * 1000),
                                "left": convertMillisecondsToDateTime(participant["time_left"] * 1000),
                                "duration": participant["time_left"] - participant["time_joined"],
                                "attention": participant["focus_time"],
                            })
                        }
                    }
                }
            }
        }
        else {
            console.log(`No Kaltura participants data for room ${roomId} and session ${sessionId}`);
        }
    }
    return res;
}

async function collectParticipantsDataFromAllSessions(sessions, bearerToken, ks){
    let res = [];
    for (let i=0; i<sessions.length; i++){
        const sessionData = await getAllUsersDataFromASingleSession(sessions[i], bearerToken, ks);
        res = res.concat(sessionData);
    }
    return res;
}

async function getAllRoomSessionsData(roomId, fromDate, toDate, bearerToken, ks){
    console.log(`Getting all sessions of room ${roomId}`);
    const result = await getRoomSessionsBetweenDates(newrowWebserverApi, bearerToken, roomId, fromDate, toDate);
    if (result) {
        console.log(`Received sessions data for room ${roomId}, now collecting participants data`)
        return await collectParticipantsDataFromAllSessions(result, bearerToken, ks);
    }
    else {
        console.log(`No sessions were found for room ${roomId}`);
        return null;
    }
}

async function generateRoomCsvFile(roomId, records){
    if (records && records.length > 0) {
        const firstRecord = records[0];
        const roomName = firstRecord["roomName"];
        const filePath = `${outputFolderPath}/${roomId}_${roomName}_${fromDate}_${toDate}.csv`;
        await generateCsvFile(filePath, roomReportFieldNames, records);
    }
}

async function getCompanySessionsMap(bearerToken){
    const allCompanySessions = await getCompanySessionsBetweenDates(newrowWebserverApi, bearerToken, fromDate, toDate);
    const sessionsMapByRoomId = new Map();
    for (const companySession of allCompanySessions){
        const roomId = companySession["room_id"];
        let roomSessions = sessionsMapByRoomId.get(roomId);
        if (!roomSessions){
            roomSessions = [];
        }
        roomSessions.push(companySession);
        sessionsMapByRoomId.set(roomId, roomSessions);
    }
    return sessionsMapByRoomId;
}

(async () => {
    try{
        let bearerToken = await getNewrowBearerToken(newrowWebserverApi, ltiKey, ltiSecret);
        bearerToken = bearerToken["token"];
        const ks = generateKS(partnerId, secret);
        const sessionsFullDataMapByRoomId = new Map();
        if (overrideRoomsIds && overrideRoomsIds.length > 0){
            console.log('Generating report for specific company rooms', overrideRoomsIds);
            for (let i=0; i<overrideRoomsIds.length; i++) {
                try {
                    console.log(`Collecting data for room ${overrideRoomsIds[i]}`);
                    const roomSessionsData = await getAllRoomSessionsData(overrideRoomsIds[i], fromDate, toDate, bearerToken, ks);
                    sessionsFullDataMapByRoomId.set(overrideRoomsIds[i], roomSessionsData);
                }
                catch (e) {
                    console.log(`Failed to collect data for room ${overrideRoomsIds[i]} with: `, e.message);
                }
            }
        }
        else {
            console.log('Generating report for all company rooms');
            const sessionsMapByRoomId = await getCompanySessionsMap(bearerToken);
            for (const [roomId, roomSessions] of sessionsMapByRoomId){
                try {
                    console.log(`Collecting data for room ${roomId}`);
                    const roomSessionsData = await collectParticipantsDataFromAllSessions(roomSessions, bearerToken, ks);
                    sessionsFullDataMapByRoomId.set(roomId, roomSessionsData);
                }
                catch (e) {
                    console.log(`Failed to collect data for room ${roomId} with: `, e.message);
                }
            }
        }
        for (const [roomId, roomSessionsFullData] of sessionsFullDataMapByRoomId){
            console.log(`Generating csv file for room ${roomId}`);
            await generateRoomCsvFile(roomId, roomSessionsFullData);
        }
        const zipFileName = `${outputFolderPath}/Company_${companyId}_Report_${fromDate}_${toDate}.zip`;
        console.log('Generating final zip file');
        await generateZipFile(outputFolderPath, zipFileName);
        console.log("Finished generating zip file");
    }
    catch (e){
        console.log(e.message);
    }
})();


