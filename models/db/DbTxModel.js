const oracledb = require("oracledb");
const dbConfigPool = require('../../config/db/dbconfigpool');

("use strict");
Error.stackTraceLimit = 50;

class DbTxModel {
    /**
     * ดำเนินการชุดคำสั่ง Database ภายใต้ Transaction เดียวกัน (ACID: Atomicity, Consistency, Isolation, Durability)
     * หากเกิดข้อผิดพลาดหรือ Interruption จะทำการ Rollback ข้อมูลทั้งหมดโดยอัตโนมัติ
     * 
     * @param {Function} handler - ฟังก์ชัน async (connection, tx) => Promise<any>
     * @returns {Promise<any>} ผลลัพธ์ที่ return จาก handler
     */
    static async withTransaction(handler) {
        const pool = await dbConfigPool;
        const connection = await pool.getConnection();

        try {
            // Helper utilities สำหรับเรียกใช้งานภายใน Transaction Scope
            const tx = {
                connection,

                /**
                 * รันคำสั่ง SQL เดี่ยวแบบ Transaction (autoCommit: false)
                 */
                executeOne: async (sql, binds = [], options = {}) => {
                    const execOptions = {
                        autoCommit: false,
                        outFormat: oracledb.OUT_FORMAT_OBJECT,
                        ...options
                    };
                    return await connection.execute(sql, binds, execOptions);
                },

                /**
                 * รันคำสั่ง SQL แบบกลุ่ม (Batch) เช่น Batch Insert/Update (autoCommit: false)
                 */
                executeMany: async (sql, data = [], options = {}) => {
                    const execOptions = {
                        autoCommit: false,
                        ...options
                    };
                    return await connection.executeMany(sql, data, execOptions);
                },

                /**
                 * ค้นหาข้อมูล 1 แถวแรกภายใน Transaction
                 */
                fetchOne: async (sql, binds = [], options = {}) => {
                    const execOptions = {
                        outFormat: oracledb.OUT_FORMAT_OBJECT,
                        ...options
                    };
                    const res = await connection.execute(sql, binds, execOptions);
                    return res.rows && res.rows.length > 0 ? res.rows[0] : null;
                },

                /**
                 * ค้นหาข้อมูลทั้งหมดภายใน Transaction
                 */
                fetchAll: async (sql, binds = [], options = {}) => {
                    const execOptions = {
                        outFormat: oracledb.OUT_FORMAT_OBJECT,
                        ...options
                    };
                    const res = await connection.execute(sql, binds, execOptions);
                    return res.rows || [];
                },

                /**
                 * Alias สำหรับ fetchAll / execute query returning rows
                 */
                executeAll: async (sql, binds = [], options = {}) => {
                    const execOptions = {
                        outFormat: oracledb.OUT_FORMAT_OBJECT,
                        ...options
                    };
                    const res = await connection.execute(sql, binds, execOptions);
                    return res.rows || [];
                }
            };

            const result = await handler(connection, tx);
            await connection.commit();
            return result;
        } catch (err) {
            try {
                await connection.rollback();
                console.warn('[DbTxModel] Transaction rolled back safely:', err?.message || err);
            } catch (rollbackErr) {
                console.error('[DbTxModel] Rollback failure:', rollbackErr);
            }
            throw err;
        } finally {
            if (connection) {
                try {
                    await connection.close();
                } catch (closeErr) {
                    console.error('[DbTxModel] Connection close error:', closeErr);
                }
            }
        }
    }

    // Static fallback helpers
    static async executeMany(connection, sql, data = [], options = {}) {
        const execOptions = { autoCommit: false, ...options };
        return await connection.executeMany(sql, data, execOptions);
    }

    static async executeOne(connection, sql, binds = {}, options = {}) {
        const execOptions = { autoCommit: false, ...options };
        return await connection.execute(sql, binds, execOptions);
    }
}

module.exports = DbTxModel;
