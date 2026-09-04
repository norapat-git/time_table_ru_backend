var oracledb = require("oracledb");
const dbConfig = require("../../config/db/dbconfig");
const dbConfigPool = require("../../config/db/dbconfigpool");
require("dotenv").config();

("use strict");

Error.stackTraceLimit = 50;

/*
//@ use theme for pool connections can't work
const dbConfig = require('../../config/db/dbconfig');
*/
class PLModel {
  static async pldb(res, sql, value, options) {
    let connection;
    try {
      const conn = await dbConfigPool;
      connection = await dbConfigPool.getConnection();
      //connection = await oracledb.getConnection(dbConfig); //=>  get standalone connection

      // Create a PL/SQL stored procedure
      await connection.execute(
        `CREATE OR REPLACE PROCEDURE no_proc
                 (p_in IN VARCHAR2, p_inout IN OUT VARCHAR2, p_out OUT NUMBER)
               AS
               BEGIN
                 p_inout := p_in || p_inout;
                 p_out := 101;
               END;`
      );

      const result = await connection.execute(
        `BEGIN
                 no_proc(:i, :io, :o);
               END;`,
        {
          i: "Chris", // Bind type is determined from the data.  Default direction is BIND_IN
          io: { val: "Jones", dir: oracledb.BIND_INOUT },
          o: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        }
      );

      //  console.log(result.outBinds);
    } catch (err) {
      return res
        .status(403 || 500)
        .json({ success: false, message: err.message });
    } finally {
      if (connection) {
        try {
          await connection.close(); // Put the connection back in the pool
        } catch (err) {
          //throw (err);
          res.status(200 || 403).json({ success: false, message: err.message });
        }
      }
    }
  }

  static async callProcedure(res, sql, data, options) {
    let connection;

    try {
      const conn = await dbConfigPool;
      connection = await conn.getConnection();
      // connection = await oracledb.getConnection(); // get connection from pool cache
      const result = await connection.executeMany(sql, data, options);
      //console.log("Result is:", result.outBinds);
      let outBinds = result.outBinds;
      if (Object.keys(result.outBinds).length > 0) {
        return outBinds;
      } else {
        return (outBinds = null);
      }
    } catch (err) {
      return res
        .status(403 || 500)
        .json({ success: false, message: err.message });
    } finally {
      if (connection) {
        try {
          await connection.close(); // Put the connection back in the pool
        } catch (err) {
          //throw (err);
          res.status(200 || 403).json({ success: false, message: err.message });
        }
      }
    }
  }
}
module.exports = PLModel;
