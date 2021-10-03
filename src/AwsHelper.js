const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const fs = require("fs");
const path = require("path");

async function uploadFileToS3(filePath, region, bucketName){
    try{
        const s3Client = new S3Client({ region });

        const fileStream = fs.createReadStream(filePath);
        const uploadParams = {
            Bucket: bucketName,
            // Add the required 'Key' parameter using the 'path' module.
            Key: path.basename(filePath),
            // Add the required 'Body' parameter
            Body: fileStream,
        };
        const data = await s3Client.send(new PutObjectCommand(uploadParams));
        console.log("Success", data);
        return data; // For unit tests.
    } catch (err) {
        console.log("Error", err);
    }
}

module.exports = { uploadFileToS3 };
