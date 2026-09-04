const dbConfig = require("../../config/db/dbconfig");
const dbConfigPool = require("../../config/db/dbconfigpool");
var oracledb = require("oracledb");
require("dotenv").config();

("use strict");

Error.stackTraceLimit = 50;
const UpdateModel = {

  async updatedb(res, sql, data, options) {
    let connection;

    try {
      const pool = await dbConfigPool;
      connection = await pool.getConnection();

      // แนะนำให้กำหนด autoCommit เพื่อกันลืม commit
      const execOptions = { autoCommit: true, ...options };

      const result = await connection.execute(sql, data, execOptions);       
      return result.rowsAffected === 1;
    } catch (err) {
      // ถ้าต้องการคงรูปแบบเดิมไว้ (ส่งเป็น JSON)
      
      return false; // กันคนเรียกไปใช้แล้วคาดหวัง boolean
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeErr) {
          // อย่าส่ง res ซ้ำใน finally (อาจ response ไปแล้ว)
          console.error("DB connection close error:", closeErr);
        }
      }
    }
  },
  // Execute by transaction
   async executeMany(connection, sql, data = [], options = {}) {
        const execOptions = { autoCommit: false, ...options }; // สำคัญ
        const result = await connection.executeMany(sql, data, execOptions);
        return result;
    },

   async executeOne(connection, sql, binds = {}, options = {}) {
        const execOptions = { autoCommit: false, ...options };
        const result = await connection.execute(sql, binds, execOptions);
        return result;
    }

  /* async updatedb(res, sql, data, options) {
    let connection;
    try {

      const conn = await dbConfigPool;
      connection = await conn.getConnection();
      // connection = await oracledb.getConnection(); // get connection from pool cache
      //connection = await oracledb.getConnection(dbConfig); //=>  get standalone connection
      return new Promise(async (resolve, reject) => {
        const result = await connection.execute(sql, data, options);

        if (result.rowsAffected == 1) {
          resolve(true); //
        } else {
          resolve(false); //
          // reject(resolve  )
        }
      });
    } catch (err) {
      return res
        .status(200)
        .json({ success: false, message: err.message });
    } finally {
      if (connection) {
        try {
          // Always close connections
          await connection.close();
        } catch (err) {
          return res
            .status(200)
            .json({ success: false, message: err.message });
        }
      }
    }
  }, */

  
};
module.exports = UpdateModel;
