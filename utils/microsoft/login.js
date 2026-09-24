const axios = require('axios');

const Helper = {
    async microsoftLogin(username, password, res, results) {
        const cleanUser = (username || '').trim();
        const rawPwd = (password || '').toString();

        // จัดการอักขระพิเศษสำหรับ Query URL:
        // authen365 ของ ม.ร. ต้องการรับเครื่องหมาย @ แบบตรงๆ (ไม่แปลงเป็น %40)
        // ส่วนอักขระที่ส่งผลต่อโครงสร้าง Query URL เช่น &, #, +, %, space ยังคง encode ตามปกติ
        const pwdWithAt = encodeURIComponent(rawPwd).replace(/%40/g, '@');
        const userWithAt = encodeURIComponent(cleanUser).replace(/%40/g, '@');

        const createConfig = (pwdParam) => ({
            method: 'post',
            maxBodyLength: Infinity,
            url: `https://service-regisapps.ru.ac.th/authen365/login?username=${userWithAt}&password=${pwdParam}`,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({
                username: cleanUser,
                password: rawPwd
            })
        });

        try {
            // รอบที่ 1: ส่งด้วย @ แบบปกติใน URL
            const response = await axios.request(createConfig(pwdWithAt));
            return response.data;
        } catch (error) {
            // หากรอบแรกไม่ผ่าน และรหัสผ่านมี @ ให้ลอง fallback ด้วย %40 เผื่อบางกรณี
            if (rawPwd.includes('@')) {
                try {
                    const fallbackRes = await axios.request(createConfig(encodeURIComponent(rawPwd)));
                    if (fallbackRes?.data) {
                        return fallbackRes.data;
                    }
                } catch (_) {}
            }
            return {
                success: false,
                message: error.response?.data?.message || 'E-mail or password invalid: ' + error.message
            };
        }
    }
};

module.exports = Helper;