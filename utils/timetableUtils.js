/**
 * timetableUtils.js
 * 
 * Shared utility functions สำหรับ timetable controllers ทั้งหมด
 * รวมฟังก์ชันที่ใช้ร่วมกันหลายไฟล์ เพื่อหลีกเลี่ยงการ duplicate code
 * 
 * ฟังก์ชันที่รวมไว้:
 *  - sanitizeUsername   → แปลง email / raw string → username
 *  - formatMilitaryTime → แปลงเวลา 4 หลัก (0800) → "08:00"
 *  - isTimeOverlapping  → ตรวจสอบ time overlap ระหว่าง 2 ช่วงเวลา
 */

'use strict';

/**
 * แปลง raw string (เช่น email หรือ username) ให้เป็น username สั้น
 * ตัดส่วน @domain ออก และ trim whitespace
 * @param {string|null} raw - ค่า input (เช่น "admin@example.com" หรือ "admin")
 * @param {string} defaultVal - ค่า default เมื่อ raw เป็น null/empty (default: 'SYSTEM')
 * @returns {string}
 */
function sanitizeUsername(raw, defaultVal = 'SYSTEM') {
    if (!raw) return defaultVal;
    const str = raw.toString().trim();
    if (!str) return defaultVal;
    const name = str.split('@')[0].trim();
    return name || defaultVal;
}

/**
 * แปลงเวลา military format 4 หลัก (เช่น "0800" หรือ 800) → "08:00"
 * หากมี colon อยู่แล้ว (เช่น "08:00") จะ return ค่าเดิม
 * @param {string|number|null} t - เวลา input
 * @returns {string}
 */
function formatMilitaryTime(t) {
    if (!t) return '';
    const str = t.toString().trim();
    // ถ้ามี colon แล้ว (e.g. "08:00") → return ตรง
    if (str.includes(':')) return str;
    // ถ้ายังไม่มี colon → padStart แล้วแทรก colon
    const padded = str.padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

/**
 * ตรวจสอบว่าช่วงเวลา A และ B ทับซ้อน (overlap) กันหรือไม่
 * รองรับทั้งรูปแบบ "0800" (ไม่มีโคลอน) และ "08:00" (มีโคลอน)
 * @param {string|number} startA - เวลาเริ่มต้นของช่วง A
 * @param {string|number} endA   - เวลาสิ้นสุดของช่วง A
 * @param {string|number} startB - เวลาเริ่มต้นของช่วง B
 * @param {string|number} endB   - เวลาสิ้นสุดของช่วง B
 * @returns {boolean} true ถ้าช่วงเวลา A และ B ทับซ้อนกัน
 */
function isTimeOverlapping(startA, endA, startB, endB) {
    if (!startA || !endA || !startB || !endB) return false;
    // นำ colon ออกก่อนแปลงเป็น number เพื่อรองรับทั้ง "0800" และ "08:00"
    const toNum = (v) => parseInt(v.toString().trim().replace(':', ''), 10);
    const aS = toNum(startA);
    const aE = toNum(endA);
    const bS = toNum(startB);
    const bE = toNum(endB);
    if (isNaN(aS) || isNaN(aE) || isNaN(bS) || isNaN(bE)) return false;
    return aS < bE && aE > bS;
}

/**
 * ดึงปีการศึกษาและภาคเรียนที่ active จาก RG_SCHEDULE_YEARSEM
 * หากไม่มี record ที่ STUDY_ACTIVE = '1' จะ fallback ไปยังปี/ภาคเรียนล่าสุด
 * @param {object} res - Express response object (สำหรับ SelectModel.findAll)
 * @returns {Promise<{STUDY_YEAR: string, STUDY_SEMESTER: string, STUDY_ACTIVE: string}|null>}
 */
async function getActiveYearSemHelper(res) {
    try {
        const SelectModel = require('../models/db/SelectModel');
        const activeSql = `
            SELECT 
                TRIM(STUDY_YEAR) AS STUDY_YEAR,
                TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER,
                TRIM(NVL(STUDY_ACTIVE, '0')) AS STUDY_ACTIVE
            FROM RG_SCHEDULE_YEARSEM
            WHERE TRIM(STUDY_ACTIVE) = '1'
            AND ROWNUM = 1
        `;
        let result = await SelectModel.findAll(res, activeSql, []);
        let rows = result.rows ?? [];
        if (rows.length === 0) {
            const fallbackSql = `
                SELECT 
                    TRIM(STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(NVL(STUDY_ACTIVE, '0')) AS STUDY_ACTIVE
                FROM RG_SCHEDULE_YEARSEM
                ORDER BY STUDY_YEAR DESC, STUDY_SEMESTER DESC
            `;
            result = await SelectModel.findAll(res, fallbackSql, []);
            rows = result.rows ?? [];
        }
        return rows.length > 0 ? rows[0] : null;
    } catch (err) {
        console.error('[getActiveYearSemHelper error]', err);
        return null;
    }
}

module.exports = {
    sanitizeUsername,
    formatMilitaryTime,
    isTimeOverlapping,
    getActiveYearSemHelper,
};

