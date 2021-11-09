const config = require("config");

const { getNewrowBearerToken, getRoomSessionsBetweenDates, getSessionParticipantsData, getCompanySessionsBetweenDates,
    generateCompanyAggregatedReport, getSessionChatMessages
} = require('./src/NewrowHelper');
const { generateKS, getKalturaUsersRegistrationInfo } = require('./src/KalturaHelper');
const { generateZipFile, convertMillisecondsToDateTime, generateCsvFile } = require('./src/utils');

const newrowWebserverApi = config.get("newrow.webserver_api");
const ltiKey = config.get("newrow.lti_key");
const ltiSecret = config.get("newrow.lti_secret");
const companyId = config.get("newrow.company_id");
const overrideRoomsIds = config.get("newrow.override_rooms_ids");
const adminToken = config.get("newrow.admin_token");

const kalturaApiServerHost = config.get("kaltura.api_server_host");
const partnerId = config.get("kaltura.partner_id");
const secret = config.get("kaltura.admin_secret");

const fromDate = config.get("report_start_time");
const toDate = config.get("report_end_time");
const outputFolderPath = config.get("output_path");
const timezone = config.get("timezone");

const roomParticipantsReportFieldNames = [
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

const chatTypes = ['regular', 'questions', 'moderators'];

const chatReportFieldNames = [
    {id: 'time', title: 'Time'},
    {id: 'user_name', title: 'Name'},
    {id: 'user_type', title: 'User Type'},
    {id: 'message', title: 'Message'},
    {id: 'email', title: 'Email'},
    {id: 'third_party_user_id:', title: 'TP User ID'},
];

function checkIfShouldAddUserToReport(userRegistrationInfo){
    /*
    let shouldIncludeUser = userRegistrationInfo["email"].includes("amazon");
    shouldIncludeUser &= userRegistrationInfo.hasOwnProperty("connectWithPartners") && userRegistrationInfo["connectWithPartners"] === "true";
    return shouldIncludeUser;
     */
    return true;
}

function aggregateSameUserData(previousData, currentData) {
    previousData["duration"] += currentData["duration"];
    previousData["attention"] += currentData["attention"];
    previousData["joined"] = Math.min(previousData["joined"], currentData["joined"]);
    previousData["left"] = Math.max(previousData["left"], currentData["left"]);
    return previousData;
}

async function getAllUsersDataFromASingleSession(session, bearerToken, ks){
    const res = [];
    const roomId = session["room_id"];
    const sessionId = session["id"];
    console.log(`Collecting participants data for room [${roomId}] and session [${sessionId}]`);
    let newrowParticipantsData = await getSessionParticipantsData(newrowWebserverApi, bearerToken, session["id"]);
    if (newrowParticipantsData && newrowParticipantsData.length >= 1) {
        newrowParticipantsData = newrowParticipantsData.filter((participant) => participant.hasOwnProperty("tp_user_id"));
        if (newrowParticipantsData.length > 0) {
            let kalturaUsersIds = newrowParticipantsData.map((participant) => participant["tp_user_id"]);
            kalturaUsersIds = [...new Set(kalturaUsersIds)];
            console.log(`Getting Kaltura users registration info for room [${roomId}] and session [${sessionId}]`);
            const kalturaUsersRegistrationInfo = await getKalturaUsersRegistrationInfo(kalturaApiServerHost, ks, kalturaUsersIds);
            if (kalturaUsersRegistrationInfo) {
                const usersDataMap = new Map();
                const ltiRoomId = session["third_party_room_id"];
                const roomName = session["room_name"];
                for (const participant of newrowParticipantsData) {
                    const kUserId = participant["tp_user_id"];
                    if (kalturaUsersRegistrationInfo[kUserId]) {
                        const registrationInfo = kalturaUsersRegistrationInfo[kUserId];
                        if (checkIfShouldAddUserToReport(registrationInfo)) {
                            const userCurrentData = {
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
                                "joined": typeof participant["time_joined"] === 'string' ? parseInt(participant["time_joined"]) : participant["time_joined"],
                                "left": typeof participant["time_left"] === 'string' ? parseInt(participant["time_left"]) : participant["time_left"],
                                "duration": participant["time_left"] - participant["time_joined"],
                                "attention": participant["focus_time"],
                            };
                            if (usersDataMap.has(kUserId)) {
                                const aggregatedData = aggregateSameUserData(usersDataMap.get(kUserId), userCurrentData);
                                usersDataMap.set(kUserId, aggregatedData);
                            } else {
                                usersDataMap.set(kUserId, userCurrentData);
                            }
                        }
                    }
                }
                for (const [kUserId, userData] of usersDataMap) {
                    userData["joined"] = convertMillisecondsToDateTime(userData["joined"] * 1000, timezone);
                    userData["left"] = convertMillisecondsToDateTime(userData["left"] * 1000, timezone);
                    res.push(userData);
                }
            }
            else {
                console.log(`No Kaltura participants data for room ${roomId} and session ${sessionId}`);
            }
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

async function getAllRoomSessionsData(roomId, fromDate, toDate, bearerToken){
    console.log(`Getting all sessions of room ${roomId}`);
    return await getRoomSessionsBetweenDates(newrowWebserverApi, bearerToken, roomId, fromDate, toDate);
}

async function generateRoomParticipantsDataCsvFile(roomId, records){
    if (records && records.length > 0) {
        console.log(`Generating room [${roomId}] participants data report`);
        const firstRecord = records[0];
        const roomName = firstRecord["roomName"];
        const filePath = `${outputFolderPath}/${roomId}_${roomName}_${fromDate}_${toDate}_participants.csv`;
        await generateCsvFile(filePath, roomParticipantsReportFieldNames, records);
    }
    else {
        console.log(`No records for room [${roomId}]`);
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

async function processAllSessionsData(sessionsMapByRoomId, bearerToken, ks){
    const participantsFullDataMapByRoomId = new Map();
    for (const [roomId, roomSessions] of sessionsMapByRoomId){
        try {
            const roomParticipantsSessionsData = await collectParticipantsDataFromAllSessions(roomSessions, bearerToken, ks);
            participantsFullDataMapByRoomId.set(roomId, roomParticipantsSessionsData);
        } catch (e) {
            console.log(`Failed to process sessions data for room ${roomId} with: `, e.message);
        }
    }
    for (const [roomId, roomParticipantsSessionsFullData] of participantsFullDataMapByRoomId){
        await generateRoomParticipantsDataCsvFile(roomId, roomParticipantsSessionsFullData);
    }
}

async function getSpecificRoomsSessions(roomsIds, bearerToken) {
    const sessionsFullDataMapByRoomId = new Map();
    console.log('Generating report for specific company rooms', roomsIds);
    for (let i=0; i<roomsIds.length; i++) {
        try {
            console.log(`Collecting data for room ${roomsIds[i]}`);
            const roomSessionsData = await getAllRoomSessionsData(roomsIds[i], fromDate, toDate, bearerToken);
            sessionsFullDataMapByRoomId.set(roomsIds[i], roomSessionsData);
        }
        catch (e) {
            console.log(`Failed to collect data for room ${roomsIds[i]} with: `, e.message);
        }
    }
    return sessionsFullDataMapByRoomId;
}

async function createChatReports(sessionsMapByRoomId, bearerToken) {
    for (const [roomId, roomSessions] of sessionsMapByRoomId) {
        console.log(`Getting chat messages for room [${roomId}]`);
        for (const chatType of chatTypes) {
            let allRoomMessagesByType = [];
            for (const session of roomSessions) {
                const roomMessages = await getSessionChatMessages(newrowWebserverApi, bearerToken, session["id"], chatType, timezone);
                if (roomMessages.length > 0){
                    roomMessages.forEach((message) => message["time"] = convertMillisecondsToDateTime(message["time"], timezone));
                    allRoomMessagesByType = allRoomMessagesByType.concat(roomMessages);
                }
            }
            if (allRoomMessagesByType.length > 0){
                console.log(`Generating chat report for room [${roomId}] and type [${chatType}]`);
                const filePath = `${outputFolderPath}/Room_${roomId}_${chatType}_chat.csv`;
                await generateCsvFile(filePath, chatReportFieldNames, allRoomMessagesByType);
            }
        }
    }
}

(async () => {
    try{
        let bearerToken = await getNewrowBearerToken(newrowWebserverApi, ltiKey, ltiSecret);
        bearerToken = bearerToken["token"];
        const ks = generateKS(partnerId, secret);
        let sessionsFullDataMapByRoomId;
        if (overrideRoomsIds && overrideRoomsIds.length > 0){
            console.log('Collecting sessions for specific rooms', overrideRoomsIds);
            sessionsFullDataMapByRoomId = await getSpecificRoomsSessions(overrideRoomsIds, bearerToken);
        }
        else {
            console.log('Collecting sessions for all company rooms');
            sessionsFullDataMapByRoomId = await getCompanySessionsMap(bearerToken);
        }
        console.log('Generating session report for each room');
        await processAllSessionsData(sessionsFullDataMapByRoomId, bearerToken, ks);
        console.log('Generating aggregated report for the company');
        await generateCompanyAggregatedReport(newrowWebserverApi, adminToken, companyId, overrideRoomsIds, fromDate, toDate, timezone, outputFolderPath);
        console.log('Generating chat report for each room');
        await createChatReports(sessionsFullDataMapByRoomId, bearerToken);
        console.log('Generating zip file');
        const zipFileName = `${outputFolderPath}/Company_${companyId}_Report_${fromDate}_${toDate}.zip`;
        await generateZipFile(outputFolderPath, zipFileName);
        console.log('Finished all!!!')
    }
    catch (e){
        console.log(e.message);
    }
})();


