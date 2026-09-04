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


async function insertTest(req, res) {
  console.log(req.params.STUDY_YEAR);
  let connection;
  try {
    const STUDY_YEAR = req.params.STUDY_YEAR;
    const STUDY_SEMESTER = req.params.STUDY_SEMESTER;

    connection = await oracledb.getConnection(dbConfig);

    // run query to get employee with table name
    const sql = `insert into ET_COUNTER_ADMIN_TEST(STUDY_YEAR,STUDY_SEMESTER) values(:1,:2) `

    result = await connection.execute(
      sql, [STUDY_YEAR, STUDY_SEMESTER], // Bind values
      { autoCommit: true }  // Override the default, non-autocommit behavior
    );

    //console.log("Rows inserted: " + result.rowsAffected);  // 1
    let success = false;
    if (result.rowsAffected === 1) {
      success = true;
    }

    return res.status(200).json({ "successs": success });
  } catch (err) {
    //send error message
    // return res.send(err.message);
    return res.status(err.status || 500).json({ "success": false, "txt": err.message });
  } finally {
    if (connection) {
      try {
        conn = true;
        // Always close connections
        await connection.close();
      } catch (err) {
        return res.status(err).json({ "success": false, "txt": err.message });
        // return console.error(err.message);
      }
    }
  }
}

async function insertMulti(req, res) {

  const sql = "INSERT INTO no_em_tab values (:a, :b, :c,sysdate)";

  const binds = [
    { a: 1, b: "Test 1 (One)", c: "Test13444444444444ef" },
    { a: 2, b: "Test 2 (two)", c: "Test2" },
    { a: 3, b: "Test 3 (three)", c: "Test3" },
  ];


  // bindDefs is optional for IN binds but it is generally recommended.
  // Without it the data must be scanned to find sizes and types.
  const options = {
    autoCommit: true,
    bindDefs: {
      a: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER },
      b: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, maxSize: 15 },
      c: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, maxSize: 15 }
    }
  };

  let connection;

  try {

    const { STUDY_YEAR, STUDY_SEMESTER, FISCAL_YEAR } = req.body;

    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.executeMany(sql, binds, options);
    //console.log("Result is:", result);

    /* const result2 = await connection.execute(
      `SELECT * FROM no_em_tab`
    );
    console.log(result2.rows); */

    return res.status(200).json({ "successs": true, "txt": 'insert' });
  } catch (err) {
    return res.status(err.status || 500).json({ "success": false, "txt": err.message });
  } finally {
    if (connection) {
      try {
        conn = true;
        // Always close connections
        await connection.close();
      } catch (err) {
        return res.status(err).json({ "success": false, "txt": err.message });
        // return console.error(err.message);
      }
    }
  }
}


module.exports = { insertTest, insertMulti };
