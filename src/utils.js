const archiver = require('archiver');
const axios = require("axios");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fileSystem = require('fs');
const qs = require('querystring');
const https = require('https');

async function sendHttpRequest(url, method = 'GET', params = {}, config = {}){
    let res = null;
    return new Promise(async (resolve, reject) => {
        try {
            params = qs.stringify(params);
            if (method === 'GET') {
                res = await axios.get(`${url}?${params}`, config);
            } else if (method === 'POST') {
                res = await axios.post(url, params, config);
            }
            resolve(res);
        }
        catch (e){
            console.error(`HTTP request failed with: ${e.message}`, { url, method, params, config });
            reject(e);
        }
    });
}

function httpsRequest(params, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(params, function(res) {
            // reject on bad status
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error('statusCode=' + res.statusCode));
            }
            // cumulate data
            let body = [];
            res.on('data', function(chunk) {
                body.push(chunk);
            });
            // resolve on end
            res.on('end', function() {
                try {
                    body = JSON.parse(Buffer.concat(body).toString());
                } catch(e) {
                    reject(e);
                }
                resolve(body);
            });
        });
        // reject on request error
        req.on('error', function(err) {
            // This is not a "Second reject", just a different sort of failure
            reject(err);
        });
        if (postData) {
            req.write(postData);
        }
        // IMPORTANT
        req.end();
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

function convertMillisecondsToDateTime(time, timeZone = 'GMT'){
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

module.exports = { sendHttpRequest, generateZipFile, convertMillisecondsToDateTime, convertDateStrToRightTimeZone,
    generateCsvFile, httpsRequest }
