var oracledb = require("oracledb");
const dbConfigPool = require('../../config/db/dbconfigpool');
require('dotenv').config();
/*
//@ use theme for pool connections can't work
const dbConfig = require('../../config/db/dbconfig');
*/
const DeleteModel = {
  async deletedb(res, sql, data, options = {}) {
    let connection;

    try {
      const pool = await dbConfigPool;
      connection = await pool.getConnection();

      // ใส่ autoCommit เป็นค่าเริ่มต้น (ถ้าส่งมาแล้วจะทับได้)
      const execOptions = { autoCommit: true, ...options };

      const result = await connection.execute(sql, data, execOptions);
      const rowsAffected = result?.rowsAffected ?? 0;
      return rowsAffected > 0
    } catch (err) {
      //res.status(403).json({ success: false, message: err?.message ?? String(err) }); 
      
      return false; //{ success: false, rowsAffected: 0 };
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeErr) {
          console.error("DB connection close error:", closeErr);
        }
      }
    }
  },

  /* async deletedb(res, sql, data, options) {
    let connection;

    try {
      const pool = await dbConfigPool;
      connection = await pool.getConnection();

      // const options = { autoCommit: true };

      const result = await connection.execute(sql, data, options);
      return (result?.rowsAffected ?? 0) > 0;
    } catch (err) {
      res
        .status(403)
        .json({ success: false, message: err?.message ?? String(err) });
      return false;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeErr) {
          // อย่าส่ง res ซ้ำใน finally
          console.error("DB connection close error:", closeErr);
        }
      }
    }
  },
   */
  // Optimized version
  async deletedbop(res, sql, data = {}) {
    let connection;

    try {
      const pool = await dbConfigPool;
      connection = await pool.getConnection();

      const result = await connection.execute(sql, data, { autoCommit: true });
      return (result?.rowsAffected ?? 0) >= 0;
    } catch (err) {
      res.status(403).json({ success: false, message: err?.message ?? String(err) });
      return false;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeErr) {
          console.error("DB connection close error:", closeErr);
        }
      }
    }
  }

  // Old version

  /*  async deletedb(res, sql, data) {
     let connection;
     try {
 
       const options = {
         //dmlRowCounts: true,
         autoCommit: true
       };
 
       const conn = await dbConfigPool;
       connection = await conn.getConnection();
       // connection = await oracledb.getConnection(); // get connection from pool cache
       //connection = await oracledb.getConnection(dbConfig); //=>  get standalone connection
       return new Promise(async (resolve, reject) => {
         const result = await connection.execute(sql, data, options);
        // console.log(result);
         if (result.rowsAffected >= 0) {
           resolve(true); //
         } else {
           resolve(false); //
           // reject(false); //
         }
       });
 
     } catch (err) {
       return res.status(403).json({ 'success': false, 'message': err.message });
     } finally {
       if (connection) {
         try {
           await connection.close(); // Put the connection back in the pool
         } catch (err) {
           res.status(403).json({ "success": false, "message": err.message });
         }
       }
     }
   } */
}
module.exports = DeleteModel;
