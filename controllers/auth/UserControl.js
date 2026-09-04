
const SelectModel = require('../../models/db/SelectModel')
const UpdateModel = require('../../models/db/UpDateModel')

'use strict';
Error.stackTraceLimit = 50;

const DataController = {

    async finAllUser(req, res) {
        try {

            const { flag, username } = req.body;
            if (!flag) {
                return res.status(200).json({ "success": false, "message": `Unauthorized data access. ` });
            }

            // flag 0 = all user
            // flag 1 = specific user
            const data = flag == 0 ? [] : [username];
            const tmp = flag == 0 ? `` : ` WHERE USER_NAME = :0 `;
            const sql = `SELECT sysdate FROM dual ${tmp}`;

            const result = await SelectModel.findAll(res, sql, data);
            return res.status(200).json({
                "success": result.rows.length > 0,
                "message": result.rows.length > 0 ? `` : `Data not found.`,
                "data": result.rows
            });
            
        } catch (error) {
            console.log(error);
            return res.status(400).json({ success: false, message: error.message });
        }
    },

    async EditUser(req, res) {
        try {

            const { flag} = req.body;
            if (!flag) {
                return res.status(200).json({ "success": false, "message": `Unauthorized data access. ` });
            }
 
            const data = [ USER_NAME,FACULTY_NO,FIRST_NAME,LAST_NAME,MAJOR_NO,TELEPHONE_NO,SYS_LEVEL,SYS_ACCESS]; 
            const sql = `update 
                    test 
                    set 
                    USER_NAME = :1
                    where  USER_NAME = :0`; 

            const result = await UpdateModel.update(res, sql, data);
            return res.status(200).json({
                "success": result.rows.length > 0,
                "message": result.rows.length > 0 ? `` : `Data not found.`,
                "data": result.rows
            });


        } catch (error) {
            console.log(error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = DataController