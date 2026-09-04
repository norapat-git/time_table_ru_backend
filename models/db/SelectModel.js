// const dbConfig = require("../../config/db/dbconfig");
const dbConfigPool = require("../../config/db/dbconfigpool");
var oracledb = require("oracledb"); 

("use strict");
Error.stackTraceLimit = 50;

class Model {
  // db = pool.pool; // only one for fn
 /*  static async findAll(res, sql, data) {
    let connection;
    try {
      if (!sql) {
        return res
          .status(200)
          .json({ success: false, message: "Unauthorized sql Access" });
      }

      const options = {
        outFormat: oracledb.OUT_FORMAT_OBJECT, // outFormat can be OBJECT or ARRAY. The default is ARRAY
      };

      const conn = await dbConfigPool;
      connection = await conn.getConnection();
      // connection = await oracledb.getConnection(); // get connection from pool cache
      return new Promise(async (resolve) => {
        const result = await connection.execute(sql, data, options);
        if (result.rows.length == 0) {
          resolve(result);
        } else {
          resolve(result);
        }
      }); /// return next
    } catch (err) {
      res.status(200 || 403).json({ success: false, message: err.message });
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
  } */

static async findAll(res, sql, data = {}) {
  let connection;

  try {
    if (!sql || typeof sql !== "string" || !sql.trim()) {
     // res.status(400).json({ success: false, message: "Unauthorized sql Access" });
      return null;
    }

    const pool = await dbConfigPool; 
    connection = await pool.getConnection();
    

    const options = {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    };

    const result = await connection.execute(sql, data, options);
    return result; // result.rows จะเป็น array (ว่างก็ได้)
  } catch (err) {
    console.error("DB ERROR:", err);
    return null;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) { 
        console.error("DB connection close error:", closeErr.message); 
        return null;
      }
    }
  }
}

  // Optimized query
static async findAllex(sql, data = {}) {
  let connection;
  try {
    if (!sql || typeof sql !== "string" || !sql.trim()) {
      throw new Error("SQL is required");
    }

    const pool = await dbConfigPool;
    connection = await pool.getConnection();

    return await connection.execute(sql, data, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
  } finally {
    if (connection) await connection.close();
  }
}

  static async findAllReturnJsonIsValueNull(res, sql, value) {
    let connection;
    try {
      if (!sql) {
        return res
          .status(200)
          .json({ success: false, message: "Unauthorized sql Access" });
      }

      const options = {
        outFormat: oracledb.OUT_FORMAT_OBJECT, // outFormat can be OBJECT or ARRAY. The default is ARRAY
      };

      const conn = await dbConfigPool;
      connection = await conn.getConnection();
      // connection = await oracledb.getConnection(); // get connection from pool cache
      return new Promise(async (resolve, reject) => {
        const result = await connection.execute(sql, value, options);
        if (result.rows.length == 0) {
          res
            .status(200)
            .json({ success: false, message: "Reject, query no row" });
          //reject(result);
          // return null;
        } else {
          resolve(result);
        }
      }); /// return next
    } catch (err) {
      res.status(403).json({ success: false, message: err.message });
    } finally {
      if (connection) {
        try {
          await connection.close(); // Put the connection back in the pool
        } catch (err) {
          //throw (err);
          res.status(403).json({ success: false, message: err.message });
        }
      }
    }
  }

  // Execute by transaction
    static async findAllTx(connection, sql, binds = {}, options = {}) {
        const result = await connection.execute(sql, binds, options);
        return result;
    }
};

//Model.process.once('SIGTERM', closePoolAndExit).once('SIGINT', closePoolAndExit);

module.exports = Model;
