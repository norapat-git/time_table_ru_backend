
const axios = require('axios');

const SelectModel = require('../../../models/db/SelectModel');
const InsertModel = require('../../../models/db/InsertModel');
const UpdateModel = require('../../../models/db/UpDateModel');
const Authen = require('../../../utils/microsoft/login');
const { signToken } = require('../auth_sign');

/**
 * ดึงรูปโปรไฟล์ Microsoft 365 ฝั่ง Backend
 */
async function resolveMicrosoftProfilePhoto(auth) {
    if (!auth || typeof auth !== 'object') return null;

    try {
        // 1. ตรวจสอบว่ามี URL หรือ Base64 รูปภาพมาใน response ของ authen365 โดยตรงหรือไม่
        const directPhoto = auth.photo || auth.picture || auth.avatar || auth.avatarUrl || auth.user?.photo || auth.user?.picture;
        if (directPhoto && typeof directPhoto === 'string') {
            if (directPhoto.startsWith('http://') || directPhoto.startsWith('https://') || directPhoto.startsWith('data:image/')) {
                return directPhoto;
            }
            return `data:image/jpeg;base64,${directPhoto}`;
        }

        // ถ้ามี Access Token จาก Microsoft ให้ Backend ยิงไปขอรูปจาก Microsoft Graph API โดยตรง
        const msToken = auth.access_token || auth.accessToken || auth.token;
        if (msToken && typeof msToken === 'string') {
            const photoRes = await axios.get('https://graph.microsoft.com/v1.0/me/photo/$value', {
                headers: { Authorization: `Bearer ${msToken}` },
                responseType: 'arraybuffer',
                timeout: 5000
            });
            if (photoRes.data) {
                const contentType = photoRes.headers['content-type'] || 'image/jpeg';
                const base64 = Buffer.from(photoRes.data, 'binary').toString('base64');
                return `data:${contentType};base64,${base64}`;
            }
        }
    } catch (err) {
        // ไม่พบรูป หรือไม่มีสิทธิ์เข้าถึง
        console.log('[Microsoft Photo Info]: ไม่พบรูปโปรไฟล์หรือเข้าถึงไม่ได้:', err.message);
    }

    return null;
}

const DataController = {

    async getMicrosoftLogin(req, res) {

        try {
            const { email, password } = req.body;
            console.log(req.body);

            if (!email) {
                return res.status(200).json({ "success": false, "message": 'Unauthorized Access' });
            }

            const cleanEmail = (email || '').toString().trim();

            let data = [cleanEmail.toLowerCase()];
            let sql = `select USER_EMAIL,
                    USER_THAINAME,
                    USER_ENGNAME,
                    USER_STATEIN_TIME,
                    USER_STATEOUT_TIME,
                    FLAG
 
                    FROM RG_SCHEDULE_ACCOUNT WHERE LOWER(TRIM(USER_EMAIL))=:1`;

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

            const auth = await Authen.microsoftLogin(cleanEmail, password, results_user);
            if (!auth || (Array.isArray(auth) && auth.length === 0) || auth.success === false) {
                return res.status(200).json({ success: false, message: auth?.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
            }

            // ดึงรูปโปรไฟล์ Microsoft ฝั่ง Backend
            const avatarUrl = await resolveMicrosoftProfilePhoto(auth);

            // กรองและลบข้อมูล Token / Credentials ทั้งหมดออกจาก auth_profile 
            const safeAuthProfile = typeof auth === 'object' && auth !== null ? { ...auth } : {};
            delete safeAuthProfile.access_token;
            delete safeAuthProfile.accessToken;
            delete safeAuthProfile.token;
            delete safeAuthProfile.refresh_token;
            delete safeAuthProfile.refreshToken;
            delete safeAuthProfile.password;
            delete safeAuthProfile.pwd;
            delete safeAuthProfile.secret;

            data = [cleanEmail.toLowerCase()];
            sql = `update RG_SCHEDULE_ACCOUNT set USER_STATEIN_TIME=SYSDATE where LOWER(TRIM(USER_EMAIL))=:1`;
            await UpdateModel.updatedb(res, sql, data);

            // merge data
            const results = {
                ...results_user[0],
                avatarUrl: avatarUrl || undefined,
                auth_profile: safeAuthProfile
            };

            // สร้าง Signed JWT Token 1 hr.
            const tokenPayload = {
                userId: results_user[0].USER_EMAIL || email,
                username: (results_user[0].USER_EMAIL || email).split('@')[0],
                email: results_user[0].USER_EMAIL || email,
                firstNameTH: results_user[0].USER_THAINAME || '',
                lastNameTH: '',
                role: 'ADMIN',
                roles: ['ADMIN'],
            };
            const token = signToken(tokenPayload, '1h');

            return res.status(200).json({
                success: true,
                message: 'Login successful',
                token,
                avatarUrl: avatarUrl || undefined,
                results
            });

        } catch (error) {
            return res.status(200).json({ "success": false, "message": error.message });
        }

    },

    // Endpoint จำลองการเข้าสู่ระบบตามสิทธิ์ต่างๆ
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
            const token = signToken(tokenPayload, '1h');

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

    // บันทึกเวลาออกจากระบบ
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

