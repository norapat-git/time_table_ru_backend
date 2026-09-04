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

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

async function insertDate(req, res) {

    let connection;
  
    try {
      let result, date;
  
      connection = await oracledb.getConnection(dbConfig);
  
      // When bound, JavaScript Dates are inserted using TIMESTAMP WITH LOCAL TIMEZONE
      date = new Date(1995, 11, 17); // 17th Dec 1995
      //console.log('Inserting JavaScript date: ' + date);
      result = await connection.execute(
        `INSERT INTO no_datetab (id, timestampcol, timestamptz, timestampltz, datecol)
          VALUES (1, :ts, :tstz, :tsltz, :td)`,
        { ts: date, tstz: date, tsltz: date, td: date });
      //console.log('Rows inserted: ' + result.rowsAffected);
  
     // console.log('Query Results:');
      result = await connection.execute(
        `SELECT id, timestampcol, timestamptz, timestampltz, datecol,
                TO_CHAR(CURRENT_DATE, 'DD-Mon-YYYY HH24:MI') AS CD
          FROM no_datetab
          ORDER BY id`);
      //console.log(result.rows);
  
      //console.log('Altering session time zone');
      await connection.execute(`ALTER SESSION SET TIME_ZONE='+5:00'`);  // resets ORA_SDTZ value
  
      date = new Date(); // Current Date
      //console.log('Inserting JavaScript date: ' + date);
      result = await connection.execute(
        `INSERT INTO no_datetab (id, timestampcol, timestamptz, timestampltz, datecol)
          VALUES (2, :ts, :tstz, :tsltz, :td)`,
        { ts: date, tstz: date, tsltz: date, td: date });
      //console.log('Rows inserted: ' + result.rowsAffected);
  
     // console.log('Query Results:');
      result = await connection.execute(
        `SELECT id, timestampcol, timestamptz, timestampltz, datecol,
                TO_CHAR(CURRENT_DATE, 'DD-Mon-YYYY HH24:MI') AS CD
          FROM no_datetab
          ORDER BY id`);
     // console.log(result.rows);
      // Show the queried dates are of type Date
      let ts = result.rows[0]['TIMESTAMPCOL'];
      ts.setDate(ts.getDate() + 5);
      //console.log('TIMESTAMP manipulation in JavaScript:', ts);

      if (result.rows.length == 0) {
        //query return zero 
        //return res.send("query send no rows");
        return res.status(200).json({ "success": false, "txt": 'query send no rows' });
    } else {
        //send all  
        const data = result.rows 
        return res.status(200).json({ "success": true, data,ts });
    }
  
    } catch (err) {
      console.error(err);
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error(err);
        }
      }
    }
  }


  
module.exports = { insertDate };