var oracledb = require("oracledb");
const dbConfig = require('../config/db/dbconfig.js');
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
//app.use(express.json());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

'use strict';

Error.stackTraceLimit = 50;

async function getupdatedb(req, res) {
   // console.log(req.params.STUDY_YEAR);
    let connection;
    let result;
    try {
        const val = req.params.STUDY_YEAR;
        connection = await oracledb.getConnection(dbConfig);

        // run query to get employee with table name
        const sql = ` update ET_COUNTER_ADMIN SET DUE_DATE=:dt
         where STUDY_YEAR=:id `

        result = await connection.execute(
            sql, //[3355, val], // Bind values
            {
                id: val,
                dt: { dir: oracledb.BIND_INOUT, val: "4444443434343434343", type: oracledb.STRING, maxSize: 15 }
            },
            {
                outFormat: oracledb.OBJECT, autoCommit: true// Override the default, set true or false to autocommit behavior
            } 
        );

        return res.status(200).json({ "successs": true, "txt": 'update', result });

    } catch (err) {
        //send error message 
        return res.status(err.status || 500).json({ "success": false, "txt": err.message });
    } finally {
        if (connection) {
            try {
                conn = true;
                // Always close connections
                await connection.close();
            } catch (err) {
                return res.status(err.status || 500).json({ "success": false, "txt": err.message });
                // return console.error(err.message);
            }
        }
    }
}

module.exports = { getupdatedb };