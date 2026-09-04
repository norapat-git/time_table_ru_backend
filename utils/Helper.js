require('dotenv').config();
const jwt = require('jsonwebtoken');
const moment = require('moment');
const Define = require('./Define');

const Helper = {
    //@get a date after 1 day @return miliseconds
    getExpireDay: (day = 1) => {
        return moment().add(day, Define.DAYS).valueOf();
    },
    //@return token:String
    getJWTtoken: (client_id, ACCESS_SECRET) => {
        if (expires) {
            return jwt.sign({ client_id: client_id }, ACCESS_SECRET, { expiresIn: Define.EXPIRE_TIME });
        } else {
            return jwt.sign({ client_id: client_id }, ACCESS_SECRET.ACCESS_SECRET);
        }
    },

    //@return client_id:String || throw Error
    verifyJWTtoken: (secrete_id, refresh_token) => {
        try {
            if (!refresh_token) {
                throw new Error("Unauthorized Access");
            }
            const result = jwt.verify(refresh_token, secrete_id);
            // console.log(result);
            return result;
        } catch (e) {
            throw new Error("Unauthorized Access");
        }
    },

    ////@return client_id:String || throw Error
    authJWTAccessToken: (client_id, access_token) => {
        try {
            //  console.log("Access Token:", access_token);
            if (!access_token || !client_id) {
                throw new Error("Unauthorized Access");
            }

            //let _token;
            const result = new Promise(async (resolve, reject) => {
                // const token = jwt.sign({ client_id: client_id }, access_token, { expiresIn: Define.EXPIRE_TIME, algorithm: "HS256" });
                const token = jwt.sign({ client_id: client_id }, access_token, { expiresIn: Define.EXPIRE_TIME });
                if (token) {
                    // _token = token;
                    resolve(token);
                } else {
                    reject("Unauthorized Access");
                }
            });
            if (result) {
                return result;
            } else {
                //throw new Error("Unauthorized Access");
                return null;
            }
        } catch (error) {
            // throw new Error("Unauthorized Access");
            return null;
        }
    },/// return token:promise || throw Error


}
/* exports.generateFileName = (researchNo, fileGroup, originalName) => {
    const ext = path.extname(originalName);
    const timestamp = new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, "")
        .slice(0, 14);
    const random = Math.floor(1000 + Math.random() * 9000);

    return `${researchNo}_${fileGroup}_${timestamp}_${random}${ext}`;
}; */
module.exports = Helper