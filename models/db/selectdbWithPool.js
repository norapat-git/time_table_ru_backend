var oracledb = require("oracledb");
const dbConfig = require('../config/db/dbconfig.js');
const bodyParser = require("body-parser");

var express = require('express');
const app = express();
app.use(express.json());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

'use strict';
Error.stackTraceLimit = 50;

class SelectModelBypool {
    static async getSelectAll(req, res, next, sql, ...arr) {
        try {
            await oracledb.createPool(dbConfig);
            let connection;
            try {
                // get connection from the pool and use it
                connection = await oracledb.getConnection();
                return new Promise(async (resolve, reject) => {
                    const result = await connection.execute(sql, arr,
                        {
                            outFormat: oracledb.OUT_FORMAT_OBJECT  // query result format 
                        });
                    if (result.rows.length === 0) {
                        reject(result);
                    } else {
                       // console.log("Result is:", result);
                        resolve(result);
                    }
                });
            } catch (err) { 
                return res.status(err.status || 500).json({ "success": false, "txt": err.message });
            } finally {
                if (connection) {
                    try {
                        await connection.close(); // Put the connection back in the pool
                    } catch (err) {
                        //throw (err);
                        return res.status(err.status || 500).json({ "success": false, "txt": err.message });
                    }
                }
            }
        } catch (err) {
            //send error message 
            return res.status(err.status || 500).json({ "success": false, "txt": err.message });
        } finally {
            await oracledb.getPool().close(0);
           // console.log('Pool closed');
            // process.exit(0);
        }
    }
}

module.exports =  SelectModelBypool 