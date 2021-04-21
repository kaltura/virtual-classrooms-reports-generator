const archiver = require('archiver');
const axios = require("axios");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fileSystem = require('fs');
const qs = require('querystring');

async function sendHttpRequest(url, method = 'GET', params = {}, config = {}){
    let res = null;
    return new Promise(async (resolve, reject) => {
        const requestData = {
            url,
            method,
            params,
            config,
        };
        console.log('Sending HTTP request with: %j', requestData);
        try {
            if (method === 'GET') {
                params = qs.stringify(params);
                res = await axios.get(`${url}?${params}`, config);
            } else if (method === 'POST') {
                res = await axios.post(url, params, config);
            }
            resolve(res);
        }
        catch (e){
            console.error(`HTTP request to ${url} failed with ${e.message}`);
            reject(e);
        }
    });
}

function generateZipFile(allFilesFolderPath, outputFilePath){
    const stream = fileSystem.createWriteStream(outputFilePath);
    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });
    return new Promise(async (resolve, reject) => {
        archive
            .directory(allFilesFolderPath, false)
            .on('error', err => reject(err))
            .pipe(stream)
        ;

        stream.on('close', () => resolve());
        await archive.finalize();
    });
}

function convertMillisecondsToDateTime(time, timeZone = 'PST'){
    time = typeof time === 'string' ? parseInt(time) : time;
    const date = new Date(time);
    return date.toLocaleString('en-US', { timeZone });
}

function convertDateStrToRightTimeZone(dateStr, newTimeZone = 'PST', originalTimeZone = 'GMT'){
    const fixedDateStr = `${dateStr} ${originalTimeZone}`;
    const time = Date.parse(fixedDateStr);
    return convertMillisecondsToDateTime(time, newTimeZone);
}

async function generateCsvFile(outputFilePath, fieldNames, records){
    const csvWriter = createCsvWriter({
        path: outputFilePath,
        header: fieldNames,
    })
    await csvWriter.writeRecords(records);
}

module.exports = { sendHttpRequest, generateZipFile, convertMillisecondsToDateTime, convertDateStrToRightTimeZone, generateCsvFile }
