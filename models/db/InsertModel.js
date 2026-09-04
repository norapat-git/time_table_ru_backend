var oracledb = require("oracledb");
const dbConfig = require("../../config/db/dbconfig.js");
const dbConfigPool = require('../../config/db/dbconfigpool');

("use strict");
Error.stackTraceLimit = 50;

class Model {

  static async insertdb(res, sql, data = {}, options = {}) {
    let connection;

    try {
      const pool = await dbConfigPool;
      connection = await pool.getConnection();

      const execOptions = { autoCommit: true, ...options };

      const result = await connection.execute(sql, data, execOptions);
      return (result?.rowsAffected ?? 0) > 0;
    } catch (err) {
      console.error("ModelInsert.insertdb Error:", err);
      res
        .status(403)
        .json({ success: false, message: err?.message ?? String(err) });

      return false;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeErr) {
          // อย่าส่ง res ซ้ำใน finally (อาจส่งไปแล้วใน catch)
          console.error("DB connection close error:", closeErr);
        }
      }
    }
  }

  static async insertdb2(res, sql, data = {}, options = {}) {
    let connection;

    try {
      const pool = await dbConfigPool;
      connection = await pool.getConnection();

      const execOptions = { autoCommit: true, ...options };

      const result = await connection.execute(sql, data, execOptions);
      return (result?.rowsAffected ?? 0) > 0;
    } catch (err) {
      // res.status(403).json({ success: false, message: err?.message ?? String(err) });

      return false;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeErr) {
          // อย่าส่ง res ซ้ำใน finally (อาจส่งไปแล้วใน catch)
          console.error("DB connection close error:", closeErr);
        }
      }
    }
  }

  /* static async insertdb(res, sql, data, options) {
    let connection;
    try {

      const conn = await dbConfigPool;
      connection = await conn.getConnection();
      // connection = await oracledb.getConnection(); // get connection from pool cache
      return new Promise(async (resolve, reject) => {
        let result = await connection.execute(sql, data, options);// Bind values must be type of array or object
        if (result.rowsAffected > 0) {
          resolve(true);
        } else {
          resolve(false); //
        }
      });

    } catch (err) {
      //return false;
      return res.status(403).json({ 'success': false, 'message': err.message });
    } finally {
      if (connection) {
        try {
          await connection.close(); // Put the connection back in the pool
        } catch (err) {
          //throw (err);
          res.status(403).json({ "success": false, "message": 'Model ' + err.message });
        }
      }
    }
  } */ /// return promise or throw exception

  static async insertMulti(res, sql, values, options) {
    // const sql = "INSERT INTO no_em_tab values (:a, :b, :c,sysdate)";

    const binds = [
      { a: 1, b: "Test 1 (One)", c: "Test13444444444444ef" },
      { a: 2, b: "Test 2 (two)", c: "Test2" },
      { a: 3, b: "Test 3 (three)", c: "Test3" },
    ];

    // bindDefs is optional for IN binds but it is generally recommended.
    // Without it the data must be scanned to find sizes and types.
    /* const options = {
      autoCommit: true,
      bindDefs: {
        a: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER },
        b: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, maxSize: 15 },
        c: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, maxSize: 15 },
      },
    }; */

    let connection;
    try {
      const { STUDY_YEAR, STUDY_SEMESTER, FISCAL_YEAR } = req.body;

      const conn = await dbConfigPool;
      connection = await conn.getConnection();
      // connection = await oracledb.getConnection(); // get connection from pool cache

      const result = await connection.executeMany(sql, binds, options);
      console.log("Result is:", result);

      return res.status(200).json({ successs: true, txt: "insert" });
    } catch (err) {
      return res.status(err.status || 403).json({ success: false, txt: err.message });
    } finally {
      if (connection) {
        try {
          conn = true;
          // Always close connections
          await connection.close();
        } catch (err) {
          return res.status(err).json({ success: false, txt: err.message });
          // return console.error(err.message);
        }
      }
    }
  }


  static async insert_many(res, sql, data = [], options = {}) {
    let connection;

    try {
      const pool = await dbConfigPool;
      connection = await pool.getConnection();

      const execOptions = { autoCommit: true, ...options };

      const result = await connection.executeMany(sql, data, execOptions);
      return (result?.rowsAffected ?? 0) > 0;
    } catch (err) {
      /* res
        .status(403)
        .json({ success: false, message: err?.message ?? String(err) }); */
      console.error("DB connection close error:", err.message ?? String(err));
      return false;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeErr) {
          // ห้ามส่ง res ซ้ำใน finally
          console.error("DB connection close error:", closeErr);
        }
      }
    }
  }

  // Execute by transaction
  static async executeMany(connection, sql, data = [], options = {}) {
    const execOptions = { autoCommit: false, ...options }; // สำคัญ
    const result = await connection.executeMany(sql, data, execOptions);
    return result;
  }

  static async executeOne(connection, sql, binds = {}, options = {}) {
    const execOptions = { autoCommit: false, ...options };
    const result = await connection.execute(sql, binds, execOptions);
    return result;
  }
};

module.exports = Model;
