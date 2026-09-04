var oracledb = require("oracledb");

const InsertModel = require('../../models/db/InsertModel');
const SelectModel = require('../../models/db/SelectModel');
const UpdateModel = require('../../models/db/UpDateModel');
const DeleteModel = require('../../models/db/DeleteModel');
const DbTx = require("../../models/db/DbTxModel");

const SECTION_TIME_MAP = {
    "1": "9.00 - 11.30 น.",
    "2": "12:00 - 14:30 น.",
    "3": "15:00 - 17:30 น.",
    "4": "18.00 - 20.30 น."
};

const DataController = {

    async counterInfo(connection) {
        try {
             let sql = `select sysdate FROM dual`;

                // const result = await SelectModel.findAll(res, sql, data);
                const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
                if (!result) return;
                const results_counter = result.rows ?? [];
                if (results_counter.length === 0) {
                    return results_counter;
                  //  return res.status(400).json({ success: false, messageTH: "ลงทะเบียนไม่สำเร็จ", messageEN: "Registration failed." });
                }

                return results_counter;
        } catch (error) {
            return null;
        }
    },
 
}





module.exports = DataController
