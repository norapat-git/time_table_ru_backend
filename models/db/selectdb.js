var oracledb = require("oracledb");
const dbConfig = require('../../config/db/dbconfig'); 

var express = require('express');
const app = express();
app.use(express.json({ limit: "50mb" })); 
app.use(express.urlencoded({ extended: false }));

'use strict';
Error.stackTraceLimit = 50;

class SelectModel {
    static async getSelectDB(req, res, sql) {
        let connection;
        // let result;
        try {

            if (sql == null) {
                throw new Error("SQL query is null or empty");
            }
            //console.log(arr);

            connection = await oracledb.getConnection(dbConfig);

            return new Promise(async (resolve, reject) => {
                //execute query
                const result = await connection.execute(
                    sql, [],
                    {
                        //resultSet: true,
                        //maxRows: 1,
                        outFormat: oracledb.OUT_FORMAT_OBJECT  // query result format
                        // , fetchArraySize: 100                    // internal buffer allocation size for tuning
                    });

                if (result.rows.length == 0) {
                    //query return zero   
                    reject(error);
                } else {
                    //query return data     
                    resolve(result);
                   // next();
                }
            });

        } catch (err) {
            //console.log(err.message);
            //send error message 
            return res.status(err.status || 500).json({ "success": false, "txt": err.message });
        } finally {
            if (connection) {
                try {
                    // Always close connections
                    await connection.close();
                } catch (err) {
                    // return console.error(err.message);
                    return res.status(err.status || 500).json({ "success": false, "txt": err.message });
                }
            }
        }
    }
}

module.exports = { SelectModel }