var oracledb = require("oracledb");

const InsertModel = require("../../models/db/InsertModel");
const SelectModel = require("../../models/db/SelectModel");
const UpdateModel = require("../../models/db/UpDateModel");
const DeleteModel = require("../../models/db/DeleteModel");
const DbTx = require("../../models/db/DbTxModel");
const fn = require("./rec-recheck-fucntion");

const DataController = {
  async exam1(req, res) {
    try {
      const { STD_CODE } = req.body;

      if (!STD_CODE) {
        return res
          .status(200)
          .json({
            success: false,
            messageEN: `เข้าถึงข้อมูลไม่สำเร็จ. `,
            messageEN: `Unauthorized data access. `,
          });
      }

      const data = [];
      const result = await DbTx.withTransaction(async (connection) => {
        // check counter info
        const [counterInfo] = await fn.counterInfo(connection);
        const { params } = counterInfo;

        if (!counterInfo) {
          return {
            success: false,
            messageTH: "ไม่พบข้อมูล",
            messageEN: "Data not found.",
          };
        }

        const sql = `  `;

        const { rows } = await connection.execute(
          // เปลี่ยนชื่อจาก res เป็น rows
          sql,
          { p1: p1, p2: p2, params3 },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );

        if (!rows?.length) {
          return {
            success: false,
            messageTH: "ไม่พบข้อมูล",
            messageEN: "data not found.",
          };
        }

        return { success: true, register_course_results: rows };
      });

      return res.status(200).json({ ...result, STD_CODE });
    } catch (error) {
      console.log(error);
      return res.status(400).json({ success: false, message: error.message });
    }
  },
};

module.exports = DataController;
