var oracledb = require("oracledb");
require('dotenv').config();

const Model = require('../models/db/InsertModel');

const DataController = {

    async insertdb(req, res) {

        if (!req.body) {
            throw new Error("SQL must be provided")
        }

        const data = [];
        const { STUDY_SEMESTER, STUDY_YEAR } = req.body;
        data.push(STUDY_SEMESTER);
        data.push(STUDY_YEAR);

        // bindDefs is optional for IN binds but it is generally recommended.
        // Without it the data must be scanned to find sizes and types.
        const options = {
            autoCommit: true,
            bindDefs: {
                STUDY_SEMESTER: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, maxSize: 1 },
                STUDY_YEAR: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, maxSize: 4 }
            }
        };

        if (!req) {
            throw new Error("Unauthorized Access")
        }
        const sql = ` `

        const results = await Model.insertdb(req, res, sql, data, options);
        if (results) {
            //query return zero
            return res.status(200).json({ "success": true, "message": 'Insert successfully.' });
        } else {
            return res.status(200).json({ "success": false, 'messege': 'Insert not successfully.' });
        }

    },

    async testinsert(req, res) {
        console.log(req.params.x);

        const data = ['1', '901'];
        const { STUDY_SEMESTER, STUDY_YEAR } = req.body;
        // bindDefs is optional for IN binds but it is generally recommended.
        // Without it the data must be scanned to find sizes and types.
        const options = {
            autoCommit: true
        };


        const sql = `insert into TEST(NEAR_GRADUATE, COUNTER_NO,   REGIS_DATE)
          values (:1,:2,sysdate)  `

        const results = await Model.insertdb(res, sql, data, options);
        if (results) {
            //query return zero
            return res.status(200).json({ "success": true, "message": 'Insert successfully.' });
        } else {
            return res.status(200).json({ "success": false, 'messege': 'Insert not successfully.' });
        }

    }
}

module.exports = DataController
