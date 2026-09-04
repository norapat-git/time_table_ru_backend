var oracledb = require("oracledb");
require('dotenv').config();
const dbConfigPool = require('../../config/db/dbconfigpool');
/*
//@ use theme for pool connections can't work
const dbConfig = require('../../config/db/dbconfig');
*/
const CreateModel = {
    async createdb(res, sql, value, options) {
        let connection;
        try {

          const conn = await dbConfigPool;
          connection = await conn.getConnection();
          // connection = await oracledb.getConnection(); // get connection from pool cache
            const stmts = [
                `DROP TABLE no_cqntable`,

                `CREATE TABLE no_cqntable (k NUMBER)`
            ];

            for (const s of stmts) {
                try {
                    await connection.execute(s,
                        { autoCommit: true });
                } catch (e) {
                    if (e.errorNum != 942)
                        throw (e);
                }
            }

        } catch (err) {
            return res.status(403 || 500).json({ "success": false, "txt": err.message });
        } finally {
            if (connection) {
                try {
                    conn = true;
                    // Always close connections
                    await connection.close();
                } catch (err) {
                    return res.status(403 || 500).json({ "success": false, "txt": err.message });
                }
            }
        }
    }
}
module.exports = CreateModel;
