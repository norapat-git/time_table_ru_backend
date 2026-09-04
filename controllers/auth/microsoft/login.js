
const axios = require('axios');

const SelectModel = require('../../../models/db/SelectModel');
const InsertModel = require('../../../models/db/InsertModel');
const UpdateModel = require('../../../models/db/UpDateModel');
const Authen = require('../../../utils/microsoft/login');
const { signToken } = require('../auth_sign');

const DataController = {

    async getMicrosoftLogin(req, res) {

        try {
            const { email, password } = req.body;
            //  console.log(req.body);

            if (!email) {
                return res.status(200).json({ "success": false, "message": 'Unauthorized Access' });
            }

            let data = [email];
            let sql = `select USER_EMAIL,
                    USER_THAINAME,
                    USER_ENGNAME,
                    USER_STATEIN_TIME,
                    USER_STATEOUT_TIME,
                    FLAG
 
                    FROM RG_SCHEDULE_ACCOUNT WHERE USER_EMAIL=:1`;

            const result_user = await SelectModel.findAll(res, sql, data);
            const results_user = result_user.rows ?? [];
            if (results_user.length === 0) {
                return res.status(200).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้งานในระบบ (กรุณาติดต่อผู้ดูแลระบบเพื่อเพิ่มสิทธิ์)' });
            }

            // ตรวจสอบสถานะการเปิดใช้งาน (FLAG: '1' = ใช้งานได้, '0' = ปิดการใช้งาน)
            const userFlag = (results_user[0].FLAG || '1').toString().trim();
            if (userFlag !== '1') {
                return res.status(200).json({ success: false, message: 'บัญชีผู้ใช้นี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
            }

            const auth = await Authen.microsoftLogin(email, password, results_user);
            if (!auth || (Array.isArray(auth) && auth.length === 0) || auth.success === false) {
                return res.status(200).json({ success: false, message: auth?.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
            }

            data = [email];
            sql = `update RG_SCHEDULE_ACCOUNT set USER_STATEIN_TIME=SYSDATE where USER_EMAIL=:1`;
            await UpdateModel.updatedb(res, sql, data);

            // merge data
            const results = {
                ...results_user[0],
                auth_profile: auth
            };

            // สร้าง Signed JWT Token สำหรับผู้ใช้งาน (อายุ 12 ชั่วโมง)
            const tokenPayload = {
                userId: results_user[0].USER_EMAIL || email,
                username: (results_user[0].USER_EMAIL || email).split('@')[0],
                email: results_user[0].USER_EMAIL || email,
                firstNameTH: results_user[0].USER_THAINAME || '',
                lastNameTH: '',
                role: 'ADMIN',
                roles: ['ADMIN'],
            };
            const token = signToken(tokenPayload, '12h');

            return res.status(200).json({
                success: true,
                message: 'Login successful',
                token,
                results
            });

        } catch (error) {
            return res.status(200).json({ "success": false, "message": error.message });
        }

    },

    // Endpoint จำลองการเข้าสู่ระบบตามสิทธิ์ต่างๆ (สำหรับ Dev / Quick Login)
    async getPresetLogin(req, res) {
        try {
            const { role = 'ADMIN', email = 'dev07@ru.ac.th', name = 'นายทดสอบ พัฒนาระบบ' } = req.body;
            const validRole = String(role).toUpperCase();

            const tokenPayload = {
                userId: email,
                username: email.split('@')[0],
                email: email,
                firstNameTH: name,
                lastNameTH: '',
                role: validRole,
                roles: [validRole],
            };
            const token = signToken(tokenPayload, '12h');

            return res.status(200).json({
                success: true,
                message: `Preset login as ${validRole} successful`,
                token,
                results: {
                    USER_EMAIL: email,
                    USER_THAINAME: name,
                    USER_ENGNAME: 'TEST DEV',
                    role: validRole,
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // บันทึกเวลาออกจากระบบ (USER_STATEOUT_TIME)
    async logout(req, res) {
        try {
            const { email } = req.body;
            if (email) {
                const cleanEmail = email.trim().toLowerCase();
                const sql = `UPDATE RG_SCHEDULE_ACCOUNT SET USER_STATEOUT_TIME = SYSDATE WHERE LOWER(USER_EMAIL) = :1`;
                await UpdateModel.updatedb(res, sql, [cleanEmail]);
            }
            return res.status(200).json({ success: true, message: 'ออกจากระบบสำเร็จ' });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

}

/* function getLogin(res, username, password) {
    // const data = `{ "username":"anusorn.w@ru.ac.th", "password":"Awongod27"}`;
    const data = `{"username":"${username}","password":"${password}"}`;

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: `http://202.41.160.113:1323/login?username=${username}&password=${password}`,
        headers: {
            'Content-Type': 'text/plain'
        },
        data: data
    };

    axios.request(config)
        .then((response) => {
            console.log(JSON.stringify(response.data));
            let data = response.data;
            res.status(200).json({ "success": true, data });
            // return response.data;
        })
        .catch((error) => {
            console.log(error);
            res.status(200).json({ "success": false, error });
            // return error;
        }); 
}*/


module.exports = DataController;

