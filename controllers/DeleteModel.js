var oracledb = require("oracledb");
require('dotenv').config();


const Model = require('../models/db/DeleteModel');

const DataController = {

    async deletedb(req, res) {
        if (!req.body) {
            throw new Error("SQL must be provided");
        }

        const { STUDY_SEMESTER,STUDY_YEAR } = req.body;
        const dataSet = [STUDY_YEAR,STUDY_SEMESTER]; 


        const sql = `DELETE FROM ET_COUNTER_ADMIN_TEST where STUDY_YEAR=:id and STUDY_SEMESTER=:2 `;
        const results = await Model.deletedb(res, sql, dataSet, options);
        if (results) {
            //query return zero  
            return res.status(200).json({ "success": true, "message": 'Delete successfully.' });
        } else {
            return res.status(200).json({ "success": false, 'messege': 'Delete not successfully.' });
        }

    }
}

module.exports = DataController
