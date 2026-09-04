const SelectModel = require('../../models/db/SelectModel');
const InsertModel = require('../../models/db/InsertModel');
const UpdateModel = require('../../models/db/UpDateModel');
const DeleteModel = require('../../models/db/DeleteModel');
const DbTxModel = require('../../models/db/DbTxModel');

const AccountController = {
    //ดึงรายชื่อผู้ใช้งานทั้งหมด 
    async listAccounts(req, res) {
        try {
            const sql = `
                SELECT 
                    USER_EMAIL,
                    USER_THAINAME,
                    USER_ENGNAME,
                    TO_CHAR(USER_STATEIN_TIME, 'YYYY-MM-DD HH24:MI:SS') AS USER_STATEIN_TIME,
                    TO_CHAR(USER_STATEOUT_TIME, 'YYYY-MM-DD HH24:MI:SS') AS USER_STATEOUT_TIME,
                    NVL(FLAG, '1') AS FLAG
                FROM RG_SCHEDULE_ACCOUNT 
                ORDER BY USER_EMAIL ASC
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const rows = result.rows ?? [];
            return res.status(200).json({ success: true, message: '', results: rows });
        } catch (error) {
            console.error('[AccountController.listAccounts error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    //เพิ่มผู้ใช้งานใหม่ 
    async addAccount(req, res) {
        try {
            const { email, thaiName, engName, flag } = req.body;
            if (!email || !email.trim()) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมลผู้ใช้งาน' });
            }

            const cleanEmail = email.trim().toLowerCase();
            const cleanThaiName = thaiName ? thaiName.trim() : '';
            const cleanEngName = engName ? engName.trim() : '';
            const cleanFlag = flag ? flag.toString() : '1';

            await DbTxModel.withTransaction(async (conn, tx) => {
                // ตรวจสอบว่ามีอีเมลนี้อยู่แล้วหรือไม่
                const checkSql = `SELECT USER_EMAIL FROM RG_SCHEDULE_ACCOUNT WHERE USER_EMAIL = :1`;
                const checkResult = await tx.fetchAll(checkSql, [cleanEmail]);
                if (checkResult && checkResult.length > 0) {
                    throw new Error(`อีเมล ${cleanEmail} มีอยู่ในระบบแล้ว`);
                }

                const insertSql = `
                    INSERT INTO RG_SCHEDULE_ACCOUNT (USER_EMAIL, USER_THAINAME, USER_ENGNAME, FLAG)
                    VALUES (:1, :2, :3, :4)
                `;
                await tx.executeOne(insertSql, [cleanEmail, cleanThaiName, cleanEngName, cleanFlag]);
            });

            return res.status(200).json({
                success: true,
                message: 'เพิ่มผู้ใช้งานสำเร็จ',
                results: { email: cleanEmail, thaiName: cleanThaiName, engName: cleanEngName, flag: cleanFlag }
            });
        } catch (error) {
            console.error('[AccountController.addAccount error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    //แก้ไขข้อมูลผู้ใช้งาน 
    async updateAccount(req, res) {
        try {
            const { email, thaiName, engName, flag } = req.body;
            if (!email || !email.trim()) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมลผู้ใช้งาน' });
            }

            const cleanEmail = email.trim().toLowerCase();
            const cleanThaiName = thaiName ? thaiName.trim() : '';
            const cleanEngName = engName ? engName.trim() : '';
            const cleanFlag = flag ? flag.toString() : '1';

            const updateSql = `
                UPDATE RG_SCHEDULE_ACCOUNT 
                SET USER_THAINAME = :1,
                    USER_ENGNAME = :2,
                    FLAG = :3
                WHERE USER_EMAIL = :4
            `;
            await UpdateModel.updatedb(res, updateSql, [cleanThaiName, cleanEngName, cleanFlag, cleanEmail]);

            return res.status(200).json({
                success: true,
                message: 'แก้ไขข้อมูลผู้ใช้งานสำเร็จ',
                results: { email: cleanEmail, thaiName: cleanThaiName, engName: cleanEngName, flag: cleanFlag }
            });
        } catch (error) {
            console.error('[AccountController.updateAccount error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    //ลบผู้ใช้งาน 
    async deleteAccount(req, res) {
        try {
            const email = req.params.email;
            if (!email || !email.trim()) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมลที่ต้องการลบ' });
            }

            const cleanEmail = email.trim().toLowerCase();
            const deleteSql = `DELETE FROM RG_SCHEDULE_ACCOUNT WHERE USER_EMAIL = :1`;
            await DeleteModel.deletedb(res, deleteSql, [cleanEmail]);

            return res.status(200).json({ success: true, message: `ลบผู้ใช้งาน ${cleanEmail} สำเร็จ` });
        } catch (error) {
            console.error('[AccountController.deleteAccount error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = AccountController;
