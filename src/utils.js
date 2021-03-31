const axios = require("axios");
const qs = require('querystring');
const fileSystem = require('fs');
const archiver = require('archiver');

async function sendHttpRequest(url, method = 'GET', params = {}, config = {}){
    let res = null;
    return new Promise(async (resolve, reject) => {
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
    const date = new Date(time * 1000);
    return date.toLocaleString('en-US', { timeZone });
}

module.exports = { sendHttpRequest, generateZipFile, convertMillisecondsToDateTime }
