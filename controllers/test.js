var oracledb = require("oracledb");
const dbConfig = require('../config/db/dbconfig.js');
const express = require("express");
const app = express();
app.use(express.json());
require('dotenv').config();
const ModelInsert = require('../models/db/InsertModel.js');
const ModelSelect = require('../models/db/SelectModel');
'use strict';
Error.stackTraceLimit = 50;

async function selectParams(req, res) {
    let connection;
    let result;

    try {
        const STUDY_YEAR = 2566;
        const STUDY_SEMESTER = 1;
        const FISCAL_YEAR = 2566;
        // console.log(req.params.STUDY_YEAR, ' ', STUDY_SEMESTER, ' ', FISCAL_YEAR);

        connection = await oracledb.getConnection(dbConfig);
        //console.log('Connection was successful!');

        // run query to get data with table name
        const sql = ` `

        result = await connection.execute(
            sql, [],
            {
                maxRows: 1,
                outFormat: oracledb.OUT_FORMAT_OBJECT  // query result format
                // , fetchArraySize: 100                    // internal buffer allocation size for tuning
            }
        );

        if (result.rows.length == 0) {
            //query return zero 
            //return res.send("query send no rows");
            return res.status(200).json({ "success": false, "txt": 'query send no rows' });
        } else {
            //send all 
            //  const newEtCounter = new etCounter(result.rows)
            const data = result.rows
            return res.status(200).json({ "success": true, data });
        }

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
                //return console.error(err.message);
                return res.status(err.status || 500).json({ "success": false, "txt": err.message });
            }
        }
    }
}

async function TestGetSelectdb(req, res) {
    try {
        const { x1, x2 } = req.body;
        // console.log(STUDY_YEAR,STUDY_SEMESTER,FISCAL_YEAR);

        let sql = `SELECT sysdate from dual`;
        let data = [];

        if (sql == null) {
            throw new Error("SQL query is null or invalid");
        }

        const results = await ModelSelect.findAll(res, sql, data);

        //console.log('frfrdrdf',results);
        if (results.rows.length ==0) {
            //query return zero  
            return res.status(200).json({ "success": false, "txt": 'query send no rows' });
        } else {
            //query return data   
            const result = results.rows;
            return res.status(200).json({ "success": true, result });
        }
    } catch (error) {
   //     return res.status(200).json({ "success": false, "txt": error.message });
        console.log(error.message);
        
    }


}


async function TestrevData(req, res) {
    try {

        const { client_id, data } = req.body;
        if (!client_id && Object.keys(data).length > 0) {
            return res.status(401).json({ "success": false, "message": `Data must be is't null. `, "err_rec": '' });
        }
        //let recdata = new INT_MASTER_GRADE(data);
        let r = res;
        let _tmpArr = [];
        let cnt_object = 0;
        let _data = JSON.parse(JSON.stringify(data));



    } catch (error) {
        console.log(error);
    }
}


module.exports = { selectParams, TestGetSelectdb, TestrevData };