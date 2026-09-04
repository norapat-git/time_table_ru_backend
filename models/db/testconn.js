var oracledb = require("oracledb");
const dbConfig = require('../config/db/dbconfig.js');
const express = require("express");
const app = express();
app.use(express.json());

'use strict';

Error.stackTraceLimit = 50;


async function conn(req, res, next) {

    let connection;

    try {
        // Get a non-pooled connection
        connection = await oracledb.getConnection(dbConfig);

       // console.log('Connection was successful!');
        return res.status(200).json({ "success": true, "txt": 'Connection was successful!' });
    } catch (err) {
        //console.error(err);
        return res.status(err.status || 500).json({ "success": false, "txt": err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                //return console.error(err);
                return res.status(err.status || 500).json({ "success": false, "txt": err.message });
            }
        }
    }
}

module.exports = { conn };