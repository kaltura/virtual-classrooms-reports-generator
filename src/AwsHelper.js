const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const { fromTemporaryCredentials } = require("@aws-sdk/credential-providers");

async function uploadFileToS3(filePath, bucketName, arnRole){
    try{
        const s3Client = new S3Client({
            region: "us-east-1",
            credentials: fromTemporaryCredentials({
                params: {
                    // Required. ARN of role to assume.
                    RoleArn: arnRole,
                },
                clientConfig: { region: "us-east-1" },
            }),
        });

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
