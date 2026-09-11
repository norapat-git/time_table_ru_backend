const SelectModel = require('../../models/db/SelectModel');
const InsertModel = require('../../models/db/InsertModel');
const DeleteModel = require('../../models/db/DeleteModel');
const DbTxModel = require('../../models/db/DbTxModel');

function sanitizeUsername(raw, defaultVal = 'SYSTEM') {
    if (!raw) return defaultVal;
    const str = raw.toString().trim();
    if (!str) return defaultVal;
    const name = str.split('@')[0].trim();
    return name || defaultVal;
}

const InstructorController = {
    // 1. ดึงรายชื่ออาจารย์ที่เปิดสอนในปีภาคที่เลือก (LIST)
    async listScheduleInstructors(req, res) {
        try {
            const { year, semester, facultyNo, search } = req.query;

            // หากไม่ได้ระบุ year, semester ให้ดึงจากปีภาคที่ active
            let targetYear = year ? year.toString().trim() : '';
            let targetSem = semester ? semester.toString().trim() : '';

            if (!targetYear || !targetSem) {
                const activeSql = `
                    SELECT TRIM(STUDY_YEAR) AS STUDY_YEAR, TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER 
                    FROM RG_SCHEDULE_YEARSEM 
                    WHERE TRIM(STUDY_ACTIVE) = '1' AND ROWNUM = 1
                `;
                const activeRes = await SelectModel.findAll(res, activeSql, []);
                if (activeRes.rows && activeRes.rows.length > 0) {
                    targetYear = activeRes.rows[0].STUDY_YEAR;
                    targetSem = activeRes.rows[0].STUDY_SEMESTER;
                }
            }

            if (!targetYear || !targetSem) {
                return res.status(200).json({ success: true, message: 'ไม่พบปีภาคการศึกษาปัจจุบัน', results: [] });
            }

            let sql = `
                SELECT 
                    TRIM(rsi.STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(rsi.STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(rsi.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ui.INSTRUCTOR_NAME_ENG) AS INSTRUCTOR_NAME_ENG,
                    TRIM(ui.INSTRUCTOR_NAME_RU30) AS INSTRUCTOR_NAME_RU30,
                    TRIM(ui.RANK_NO) AS RANK_NO,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                    TRIM(ur.RANK_NAME_THAI_L) AS RANK_NAME_THAI_L,
                    TRIM(ui.FACULTY_NO) AS FACULTY_NO,
                    TRIM(uf.FACULTY_NAME_THAI) AS FACULTY_NAME_THAI,
                    TRIM(uf.FACULTY_NAME_SHORT) AS FACULTY_NAME_SHORT,
                    TRIM(ui.DEPARTMENT_NO) AS DEPARTMENT_NO,
                    TRIM(ui.INSTRUCTOR_TYPE) AS INSTRUCTOR_TYPE,
                    TRIM(ui.INSTRUCTOR_SEX) AS INSTRUCTOR_SEX,
                    TRIM(ui.PRENAME_NO) AS PRENAME_NO,
                    TRIM(ui.FLAG_DISPLAY) AS FLAG_DISPLAY,
                    TRIM(ui.PERSONAL_ID) AS PERSONAL_ID,
                    TO_CHAR(rsi.INSERT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS INSERT_DATE,
                    TRIM(rsi.USER_INSERT) AS USER_INSERT,
                    sch.SCHEDULE_COUNT
                FROM RG_SCHEDULE_INSTRUCTOR rsi
                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rsi.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                LEFT JOIN UGB_FACULTY uf ON TRIM(ui.FACULTY_NO) = TRIM(uf.FACULTY_NO)
                LEFT JOIN (
                    SELECT 
                        TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                        COUNT(DISTINCT TRIM(rc.COURSE_NO) || '_' || rc.DAY_CODE || '_' || rc.TIME_CODE) AS SCHEDULE_COUNT
                    FROM RG_SCHEDULE_TEACH rt
                    JOIN RG_SCHEDULE_CLASS rc 
                      ON TRIM(rt.STUDY_YEAR) = TRIM(rc.STUDY_YEAR)
                     AND TRIM(rt.STUDY_SEMESTER) = TRIM(rc.STUDY_SEMESTER)
                     AND TRIM(rt.INSTRUCTOR_GROUP) = TRIM(TO_CHAR(rc.INSTR_GROUP))
                    WHERE TRIM(rt.STUDY_YEAR) = :1 AND TRIM(rt.STUDY_SEMESTER) = :2
                    GROUP BY TRIM(rt.INSTRUCTOR_CODE)
                ) sch ON TRIM(rsi.INSTRUCTOR_CODE) = sch.INSTRUCTOR_CODE
                WHERE TRIM(rsi.STUDY_YEAR) = :1 AND TRIM(rsi.STUDY_SEMESTER) = :2
            `;
            const params = [targetYear, targetSem];

            if (facultyNo && facultyNo.toString().trim() !== '') {
                sql += ` AND TRIM(ui.FACULTY_NO) = :${params.length + 1}`;
                params.push(facultyNo.toString().trim());
            }

            if (search && search.toString().trim() !== '') {
                const searchPattern = `%${search.toString().trim().toUpperCase()}%`;
                const pIndex = params.length + 1;
                sql += ` AND (
                    UPPER(TRIM(rsi.INSTRUCTOR_CODE)) LIKE :${pIndex}
                    OR UPPER(TRIM(ui.INSTRUCTOR_NAME_THAI)) LIKE :${pIndex}
                    OR UPPER(TRIM(ui.INSTRUCTOR_NAME_ENG)) LIKE :${pIndex}
                    OR UPPER(TRIM(ur.RANK_NAME_THAI_S)) LIKE :${pIndex}
                    OR UPPER(TRIM(uf.FACULTY_NAME_THAI)) LIKE :${pIndex}
                )`;
                params.push(searchPattern);
            }

            sql += ` ORDER BY ui.FACULTY_NO ASC, ui.INSTRUCTOR_NAME_THAI ASC`;

            const result = await SelectModel.findAll(res, sql, params);
            const rows = (result.rows ?? []).map(r => ({
                ...r,
                SCHEDULE_COUNT: Number(r.SCHEDULE_COUNT || 0),
                IS_SCHEDULED: Number(r.SCHEDULE_COUNT || 0) > 0,
            }));

            return res.status(200).json({
                success: true,
                message: '',
                currentYear: targetYear,
                currentSemester: targetSem,
                results: rows,
            });
        } catch (error) {
            console.error('[InstructorController.listScheduleInstructors error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 2. ดึง Master List อาจารย์ทั้งหมดจาก UGB_INSTRUCTOR สำหรับ Modal ค้นหา/เพิ่มอาจารย์
    async getMasterInstructors(req, res) {
        try {
            const { facultyNo, search } = req.query;

            let sql = `
                SELECT 
                    TRIM(ui.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ui.INSTRUCTOR_NAME_ENG) AS INSTRUCTOR_NAME_ENG,
                    TRIM(ui.INSTRUCTOR_NAME_RU30) AS INSTRUCTOR_NAME_RU30,
                    TRIM(ui.RANK_NO) AS RANK_NO,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                    TRIM(ur.RANK_NAME_THAI_L) AS RANK_NAME_THAI_L,
                    TRIM(ui.FACULTY_NO) AS FACULTY_NO,
                    TRIM(uf.FACULTY_NAME_THAI) AS FACULTY_NAME_THAI,
                    TRIM(uf.FACULTY_NAME_SHORT) AS FACULTY_NAME_SHORT,
                    TRIM(ui.DEPARTMENT_NO) AS DEPARTMENT_NO,
                    TRIM(ui.INSTRUCTOR_TYPE) AS INSTRUCTOR_TYPE,
                    TRIM(ui.INSTRUCTOR_SEX) AS INSTRUCTOR_SEX,
                    TRIM(ui.PRENAME_NO) AS PRENAME_NO,
                    TRIM(ui.FLAG_DISPLAY) AS FLAG_DISPLAY,
                    TRIM(ui.PERSONAL_ID) AS PERSONAL_ID
                FROM UGB_INSTRUCTOR ui
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                LEFT JOIN UGB_FACULTY uf ON TRIM(ui.FACULTY_NO) = TRIM(uf.FACULTY_NO)
                WHERE 1=1
            `;
            const params = [];

            if (facultyNo && facultyNo.toString().trim() !== '') {
                sql += ` AND TRIM(ui.FACULTY_NO) = :${params.length + 1}`;
                params.push(facultyNo.toString().trim());
            }

            if (search && search.toString().trim() !== '') {
                const searchPattern = `%${search.toString().trim().toUpperCase()}%`;
                const pIndex = params.length + 1;
                sql += ` AND (
                    UPPER(TRIM(ui.INSTRUCTOR_CODE)) LIKE :${pIndex}
                    OR UPPER(TRIM(ui.INSTRUCTOR_NAME_THAI)) LIKE :${pIndex}
                    OR UPPER(TRIM(ui.INSTRUCTOR_NAME_ENG)) LIKE :${pIndex}
                    OR UPPER(TRIM(ur.RANK_NAME_THAI_S)) LIKE :${pIndex}
                    OR UPPER(TRIM(uf.FACULTY_NAME_THAI)) LIKE :${pIndex}
                )`;
                params.push(searchPattern);
            }

            sql += ` ORDER BY ui.FACULTY_NO ASC, ui.INSTRUCTOR_NAME_THAI ASC`;

            const result = await SelectModel.findAll(res, sql, params);
            const rows = result.rows ?? [];

            return res.status(200).json({ success: true, message: '', results: rows });
        } catch (error) {
            console.error('[InstructorController.getMasterInstructors error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 3. เพิ่มอาจารย์เข้าสู่ปีภาคการศึกษา (ADD / BATCH ADD) พร้อมเช็คบันทึกซ้ำ
    async addScheduleInstructors(req, res) {
        try {
            const { studyYear, studySemester, instructorCodes, userInsert } = req.body;

            if (!studyYear || !studySemester || !instructorCodes) {
                return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (ปี, ภาค หรือ รหัสอาจารย์)' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanUser = sanitizeUsername(userInsert || req.body.user || req.body.email, 'SYSTEM');

            const codeList = Array.isArray(instructorCodes)
                ? instructorCodes.map(c => c.toString().trim()).filter(Boolean)
                : [instructorCodes.toString().trim()].filter(Boolean);

            if (codeList.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุอาจารย์อย่างน้อย 1 ท่าน' });
            }

            // 1. ดึงรายการอาจารย์ที่มีอยู่แล้วในปีภาคนี้เพื่อตรวจเช็คข้อมูลซ้ำ
            const existingSql = `
                SELECT TRIM(INSTRUCTOR_CODE) AS INSTRUCTOR_CODE 
                FROM RG_SCHEDULE_INSTRUCTOR 
                WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
            `;
            const existingRes = await SelectModel.findAll(res, existingSql, [cleanYear, cleanSem]);
            const existingSet = new Set((existingRes.rows || []).map(r => r.INSTRUCTOR_CODE));

            const toInsert = codeList.filter(code => !existingSet.has(code));
            const skippedDuplicates = codeList.filter(code => existingSet.has(code));

            if (toInsert.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `อาจารย์ที่เลือกทั้งหมด (${skippedDuplicates.join(', ')}) มีอยู่ในปีการศึกษา ${cleanYear} ภาค ${cleanSem} แล้ว`,
                    duplicates: skippedDuplicates,
                });
            }

            // 2. Insert รายการที่ยังไม่มี
            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const code of toInsert) {
                    const insertSql = `
                        INSERT INTO RG_SCHEDULE_INSTRUCTOR (
                            STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE, INSERT_DATE, USER_INSERT
                        ) VALUES (:1, :2, :3, SYSDATE, :4)
                    `;
                    await tx.executeOne(insertSql, [cleanYear, cleanSem, code, cleanUser]);
                }
            });

            let successMsg = `เพิ่มอาจารย์ผู้สอนสำเร็จ ${toInsert.length} ท่าน`;
            if (skippedDuplicates.length > 0) {
                successMsg += ` (ข้ามข้อมูลที่ซ้ำแล้ว ${skippedDuplicates.length} ท่าน)`;
            }

            return res.status(200).json({
                success: true,
                message: successMsg,
                insertedCount: toInsert.length,
                skippedCount: skippedDuplicates.length,
                duplicates: skippedDuplicates,
            });
        } catch (error) {
            console.error('[InstructorController.addScheduleInstructors error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // 4. ลบอาจารย์เดี่ยว (DELETE) พร้อมสำรองลง RG_SCHEDULE_INSTRUCTOR_HIS
    async deleteScheduleInstructor(req, res) {
        try {
            const { studyYear, studySemester, instructorCode, userInsert } = req.body;

            if (!studyYear || !studySemester || !instructorCode) {
                return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วนสำหรับการลบ' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanCode = instructorCode.toString().trim();
            const cleanUserHis = sanitizeUsername(userInsert || req.body.user || req.body.email, 'SYSTEM');

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 0. ตรวจสอบว่าอาจารย์ถูกนำไปจัดในตารางสอน RG_SCHEDULE_CLASS แล้วหรือไม่
                const checkScheduledSql = `
                    SELECT DISTINCT 
                        TRIM(rc.COURSE_NO) AS COURSE_NO, 
                        TRIM(uc.COURSE_NAME_THAI) AS COURSE_NAME_THAI
                    FROM RG_SCHEDULE_TEACH rt
                    JOIN RG_SCHEDULE_CLASS rc 
                      ON TRIM(rt.STUDY_YEAR) = TRIM(rc.STUDY_YEAR)
                     AND TRIM(rt.STUDY_SEMESTER) = TRIM(rc.STUDY_SEMESTER)
                     AND TRIM(rt.INSTRUCTOR_GROUP) = TRIM(TO_CHAR(rc.INSTR_GROUP))
                    LEFT JOIN UGB_COURSE uc ON TRIM(rc.COURSE_NO) = TRIM(uc.COURSE_NO)
                    WHERE TRIM(rt.STUDY_YEAR) = :1 
                      AND TRIM(rt.STUDY_SEMESTER) = :2 
                      AND TRIM(rt.INSTRUCTOR_CODE) = :3
                `;
                const scheduledClasses = await tx.fetchAll(checkScheduledSql, [cleanYear, cleanSem, cleanCode]);

                if (scheduledClasses.length > 0) {
                    const courseList = scheduledClasses.map(c => `${c.COURSE_NO}${c.COURSE_NAME_THAI ? ' (' + c.COURSE_NAME_THAI + ')' : ''}`).join(', ');
                    throw new Error(`ไม่สามารถลบอาจารย์รหัส ${cleanCode} ได้ เนื่องจากมีตารางสอนวิชา [${courseList}] ในปีการศึกษา ${cleanYear}/${cleanSem} อยู่แล้ว (กรุณาลบตารางสอนของอาจารย์ก่อน)`);
                }

                // 1. สำรองข้อมูลลง RG_SCHEDULE_INSTRUCTOR_HIS
                const archiveSql = `
                    INSERT INTO RG_SCHEDULE_INSTRUCTOR_HIS (
                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE,
                        INSERT_DATE, USER_INSERT,
                        INSERT_HIS_DATE, USER_INSERT_HIS
                    )
                    SELECT 
                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE,
                        INSERT_DATE, USER_INSERT,
                        SYSDATE, :1
                    FROM RG_SCHEDULE_INSTRUCTOR
                    WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3 AND TRIM(INSTRUCTOR_CODE) = :4
                `;
                await tx.executeOne(archiveSql, [cleanUserHis, cleanYear, cleanSem, cleanCode]);

                // 2. ลบออกจาก RG_SCHEDULE_INSTRUCTOR
                const deleteSql = `
                    DELETE FROM RG_SCHEDULE_INSTRUCTOR
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_CODE) = :3
                `;
                await tx.executeOne(deleteSql, [cleanYear, cleanSem, cleanCode]);
            });

            return res.status(200).json({
                success: true,
                message: `ลบอาจารย์รหัส ${cleanCode} และสำรองประวัติเรียบร้อยแล้ว`,
            });
        } catch (error) {
            console.error('[InstructorController.deleteScheduleInstructor error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // 5. ลบอาจารย์แบบกลุ่ม (BULK DELETE) พร้อมสำรองลง RG_SCHEDULE_INSTRUCTOR_HIS
    async deleteBulkScheduleInstructors(req, res) {
        try {
            const { studyYear, studySemester, instructorCodes, userInsert } = req.body;

            if (!studyYear || !studySemester || !instructorCodes || !Array.isArray(instructorCodes) || instructorCodes.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรายการอาจารย์ที่ต้องการลบ' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanUserHis = sanitizeUsername(userInsert || req.body.user || req.body.email, 'SYSTEM');
            const codeList = instructorCodes.map(c => c.toString().trim()).filter(Boolean);

            let deletedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 0. ตรวจสอบว่ามีอาจารย์ท่านใดในรายการถูกจัดในตารางสอนแล้วหรือไม่
                const inPlaceholders = codeList.map((_, i) => `:${i + 3}`).join(', ');
                const checkBulkSql = `
                    SELECT DISTINCT 
                        TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                        TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                        TRIM(rc.COURSE_NO) AS COURSE_NO
                    FROM RG_SCHEDULE_TEACH rt
                    JOIN RG_SCHEDULE_CLASS rc 
                      ON TRIM(rt.STUDY_YEAR) = TRIM(rc.STUDY_YEAR)
                     AND TRIM(rt.STUDY_SEMESTER) = TRIM(rc.STUDY_SEMESTER)
                     AND TRIM(rt.INSTRUCTOR_GROUP) = TRIM(TO_CHAR(rc.INSTR_GROUP))
                    LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                    WHERE TRIM(rt.STUDY_YEAR) = :1 
                      AND TRIM(rt.STUDY_SEMESTER) = :2 
                      AND TRIM(rt.INSTRUCTOR_CODE) IN (${inPlaceholders})
                `;
                const busyList = await tx.fetchAll(checkBulkSql, [cleanYear, cleanSem, ...codeList]);

                if (busyList.length > 0) {
                    const busyCodes = Array.from(new Set(busyList.map(b => `${b.INSTRUCTOR_NAME_THAI || b.INSTRUCTOR_CODE} (${b.INSTRUCTOR_CODE})`)));
                    throw new Error(`ไม่สามารถลบได้ เนื่องจากมีอาจารย์ ${busyCodes.length} ท่านถูกจัดลงในตารางสอนแล้ว: ${busyCodes.join(', ')} (กรุณาลบตารางสอนของอาจารย์ออกก่อน)`);
                }

                for (const code of codeList) {
                    // 1. สำรองข้อมูลลง HIS
                    const archiveSql = `
                        INSERT INTO RG_SCHEDULE_INSTRUCTOR_HIS (
                            STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE,
                            INSERT_DATE, USER_INSERT,
                            INSERT_HIS_DATE, USER_INSERT_HIS
                        )
                        SELECT 
                            STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE,
                            INSERT_DATE, USER_INSERT,
                            SYSDATE, :1
                        FROM RG_SCHEDULE_INSTRUCTOR
                        WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3 AND TRIM(INSTRUCTOR_CODE) = :4
                    `;
                    await tx.executeOne(archiveSql, [cleanUserHis, cleanYear, cleanSem, code]);

                    // 2. ลบออกจากตารางหลัก
                    const deleteSql = `
                        DELETE FROM RG_SCHEDULE_INSTRUCTOR
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_CODE) = :3
                    `;
                    await tx.executeOne(deleteSql, [cleanYear, cleanSem, code]);
                    deletedCount++;
                }
            });

            return res.status(200).json({
                success: true,
                message: `ลบอาจารย์ผู้สอนสำเร็จ ${deletedCount} ท่าน พร้อมบันทึกประวัติการลบเรียบร้อยแล้ว`,
                deletedCount,
            });
        } catch (error) {
            console.error('[InstructorController.deleteBulkScheduleInstructors error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },
};

module.exports = InstructorController;
