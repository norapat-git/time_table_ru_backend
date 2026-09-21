const SelectModel = require('../../models/db/SelectModel');
const InsertModel = require('../../models/db/InsertModel');
const UpdateModel = require('../../models/db/UpDateModel');
const DeleteModel = require('../../models/db/DeleteModel');
const DbTxModel = require('../../models/db/DbTxModel');

function sanitizeUsername(raw, defaultVal = 'SYSTEM') {
    if (!raw) return defaultVal;
    const str = raw.toString().trim();
    if (!str) return defaultVal;
    const name = str.split('@')[0].trim();
    return name || defaultVal;
}

const YearSemController = {
    async listYearSem(req, res) {
        try {
            const sql = `
                SELECT 
                    TRIM(STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(NVL(STUDY_ACTIVE, '0')) AS STUDY_ACTIVE,
                    TO_CHAR(INSERT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS INSERT_DATE,
                    TRIM(USER_INSERT) AS USER_INSERT
                FROM RG_SCHEDULE_YEARSEM
                ORDER BY STUDY_YEAR DESC, STUDY_SEMESTER DESC
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const rows = result.rows ?? [];
            return res.status(200).json({ success: true, message: '', results: rows });
        } catch (error) {
            console.error('[YearSemController.listYearSem error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    async getActiveYearSem(req, res) {
        try {
            const sql = `
                SELECT 
                    TRIM(STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(STUDY_ACTIVE) AS STUDY_ACTIVE,
                    TO_CHAR(INSERT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS INSERT_DATE,
                    TRIM(USER_INSERT) AS USER_INSERT
                FROM RG_SCHEDULE_YEARSEM
                WHERE TRIM(STUDY_ACTIVE) = '1'
                AND ROWNUM = 1
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const rows = result.rows ?? [];
            const active = rows.length > 0 ? rows[0] : null;
            return res.status(200).json({ success: true, message: '', results: active });
        } catch (error) {
            console.error('[YearSemController.getActiveYearSem error]', error);
            return res.status(500).json({ success: false, message: error.message, results: null });
        }
    },

    async addYearSem(req, res) {
        try {
            const { studyYear, studySemester, studyActive, userInsert } = req.body;
            if (!studyYear || !studySemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีการศึกษาและภาคการศึกษา' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanUser = sanitizeUsername(userInsert || req.body.user || req.body.email, 'SYSTEM');
            const yearNum = parseInt(cleanYear, 10);

            if (isNaN(yearNum) || yearNum < 2550 || cleanYear.length !== 4) {
                return res.status(400).json({
                    success: false,
                    message: 'ปีการศึกษาต้องเป็นตัวเลข 4 หลัก และต้องไม่ต่ำกว่าปี 2550 (เช่น 2567, 2568...)'
                });
            }

            if (!['1', '2', '3'].includes(cleanSem)) {
                return res.status(400).json({
                    success: false,
                    message: 'ภาคการศึกษาต้องเป็นภาค 1, ภาค 2 หรือภาค 3 (ภาคฤดูร้อน) เท่านั้น'
                });
            }

            const cleanActive = (studyActive === '1' || studyActive === 1 || studyActive === true || studyActive === 'true') ? '1' : '0';

            await DbTxModel.withTransaction(async (conn, tx) => {
                const checkSql = `
                    SELECT STUDY_YEAR, STUDY_SEMESTER 
                    FROM RG_SCHEDULE_YEARSEM 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                const checkResult = await tx.fetchAll(checkSql, [cleanYear, cleanSem]);
                if (checkResult && checkResult.length > 0) {
                    throw new Error(`ปีการศึกษา ${cleanYear} ภาคการศึกษาที่ ${cleanSem} มีอยู่ในระบบแล้ว`);
                }

                if (cleanActive === '1') {
                    const resetSql = `UPDATE RG_SCHEDULE_YEARSEM SET STUDY_ACTIVE = '0'`;
                    await tx.executeOne(resetSql, []);
                }

                const insertSql = `
                    INSERT INTO RG_SCHEDULE_YEARSEM (STUDY_YEAR, STUDY_SEMESTER, STUDY_ACTIVE, INSERT_DATE, USER_INSERT)
                    VALUES (:1, :2, :3, SYSDATE, :4)
                `;
                await tx.executeOne(insertSql, [cleanYear, cleanSem, cleanActive, cleanUser]);
            });

            return res.status(200).json({
                success: true,
                message: 'เพิ่มข้อมูลปีภาคการศึกษาสำเร็จ',
                results: { STUDY_YEAR: cleanYear, STUDY_SEMESTER: cleanSem, STUDY_ACTIVE: cleanActive, USER_INSERT: cleanUser }
            });
        } catch (error) {
            console.error('[YearSemController.addYearSem error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    async updateYearSem(req, res) {
        try {
            const { oldYear, oldSemester, newYear, newSemester, studyActive, userInsert } = req.body;
            if (!oldYear || !oldSemester || !newYear || !newSemester) {
                return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
            }

            const oYear = oldYear.toString().trim();
            const oSem = oldSemester.toString().trim();
            const nYear = newYear.toString().trim();
            const nSem = newSemester.toString().trim();
            const cleanUser = sanitizeUsername(userInsert || req.body.user || req.body.email, 'SYSTEM');
            const yearNum = parseInt(nYear, 10);

            if (isNaN(yearNum) || yearNum < 2550 || nYear.length !== 4) {
                return res.status(400).json({
                    success: false,
                    message: 'ปีการศึกษาต้องเป็นตัวเลข 4 หลัก และต้องไม่ต่ำกว่าปี 2550 (เช่น 2567, 2568...)'
                });
            }

            if (!['1', '2', '3'].includes(nSem)) {
                return res.status(400).json({
                    success: false,
                    message: 'ภาคการศึกษาต้องเป็นภาค 1, ภาค 2 หรือภาค 3 (ภาคฤดูร้อน) เท่านั้น'
                });
            }

            const cleanActive = (studyActive === '1' || studyActive === 1 || studyActive === true || studyActive === 'true') ? '1' : '0';

            await DbTxModel.withTransaction(async (conn, tx) => {
                if (oYear !== nYear || oSem !== nSem) {
                    const checkSql = `
                        SELECT STUDY_YEAR, STUDY_SEMESTER 
                        FROM RG_SCHEDULE_YEARSEM 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `;
                    const checkResult = await tx.fetchAll(checkSql, [nYear, nSem]);
                    if (checkResult && checkResult.length > 0) {
                        throw new Error(`ปีการศึกษา ${nYear} ภาคการศึกษาที่ ${nSem} มีอยู่ในระบบแล้ว`);
                    }
                }

                if (cleanActive === '1') {
                    const resetSql = `UPDATE RG_SCHEDULE_YEARSEM SET STUDY_ACTIVE = '0'`;
                    await tx.executeOne(resetSql, []);
                }

                const updateSql = `
                    UPDATE RG_SCHEDULE_YEARSEM 
                    SET STUDY_YEAR = :1,
                        STUDY_SEMESTER = :2,
                        STUDY_ACTIVE = :3,
                        INSERT_DATE = SYSDATE,
                        USER_INSERT = :4
                    WHERE TRIM(STUDY_YEAR) = :5 AND TRIM(STUDY_SEMESTER) = :6
                `;
                await tx.executeOne(updateSql, [nYear, nSem, cleanActive, cleanUser, oYear, oSem]);
            });

            return res.status(200).json({
                success: true,
                message: 'แก้ไขข้อมูลปีภาคการศึกษาสำเร็จ',
                results: { STUDY_YEAR: nYear, STUDY_SEMESTER: nSem, STUDY_ACTIVE: cleanActive, USER_INSERT: cleanUser }
            });
        } catch (error) {
            console.error('[YearSemController.updateYearSem error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    async setActiveYearSem(req, res) {
        try {
            const { studyYear, studySemester } = req.body;
            if (!studyYear || !studySemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีการศึกษาและภาคการศึกษา' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();

            await DbTxModel.withTransaction(async (conn, tx) => {
                const resetSql = `UPDATE RG_SCHEDULE_YEARSEM SET STUDY_ACTIVE = '0'`;
                await tx.executeOne(resetSql, []);

                const setActiveSql = `
                    UPDATE RG_SCHEDULE_YEARSEM 
                    SET STUDY_ACTIVE = '1' 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(setActiveSql, [cleanYear, cleanSem]);
            });

            return res.status(200).json({
                success: true,
                message: `ตั้งค่าปีการศึกษา ${cleanYear} ภาค ${cleanSem} เป็นภาคการศึกษาปัจจุบันสำเร็จ (STUDY_ACTIVE = '1')`
            });
        } catch (error) {
            console.error('[YearSemController.setActiveYearSem error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    async deleteYearSem(req, res) {
        try {
            const { year, semester } = req.params;
            if (!year || !semester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีการศึกษาและภาคการศึกษาที่ต้องการลบ' });
            }

            const cleanYear = year.toString().trim();
            const cleanSem = semester.toString().trim();
            const cleanUser = sanitizeUsername(req.body?.userInsert || req.query?.userInsert, 'ADMIN');

            await DbTxModel.withTransaction(async (conn, tx) => {
                const checkActiveSql = `
                    SELECT TRIM(NVL(STUDY_ACTIVE, '0')) AS STUDY_ACTIVE 
                    FROM RG_SCHEDULE_YEARSEM 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                const checkResult = await tx.fetchAll(checkActiveSql, [cleanYear, cleanSem]);
                if (checkResult && checkResult.length > 0 && checkResult[0].STUDY_ACTIVE === '1') {
                    throw new Error('ไม่สามารถลบปีการศึกษาและภาคเรียนที่ตั้งเป็นปัจจุบันได้ กรุณาเปลี่ยนปีภาคปัจจุบันเป็นอันอื่นก่อน');
                }

                const archiveClassSql = `
                    INSERT INTO RG_SCHEDULE_CLASS_HIS (
                        STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP,
                        INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                    )
                    SELECT 
                        STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP,
                        INSERT_DATE, SYSDATE, USER_INSERT, :1
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                `;
                try {
                    await tx.executeOne(archiveClassSql, [cleanUser, cleanYear, cleanSem]);
                } catch (e) {
                    console.warn('[deleteYearSem archiveClass warning]', e?.message);
                }

                const deleteClassSql = `
                    DELETE FROM RG_SCHEDULE_CLASS 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteClassSql, [cleanYear, cleanSem]);

                const archiveTeachSql = `
                    INSERT INTO RG_SCHEDULE_TEACH_HIS (
                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD,
                        INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                    )
                    SELECT 
                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD,
                        INSERT_DATE, SYSDATE, USER_INSERT, :1
                    FROM RG_SCHEDULE_TEACH
                    WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                `;
                try {
                    await tx.executeOne(archiveTeachSql, [cleanUser, cleanYear, cleanSem]);
                } catch (e) {
                    console.warn('[deleteYearSem archiveTeach warning]', e?.message);
                }

                const deleteTeachSql = `
                    DELETE FROM RG_SCHEDULE_TEACH 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteTeachSql, [cleanYear, cleanSem]);

                try {
                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP 
                        WHERE INSTR_GROUP NOT IN (
                            SELECT DISTINCT INSTR_GROUP 
                            FROM RG_SCHEDULE_CLASS 
                            WHERE INSTR_GROUP IS NOT NULL
                        )
                    `);
                } catch (e) {
                    console.warn('[deleteYearSem RG_SCHEDULE_INSTRUCTOR_GROUP cleanup warning]', e?.message);
                }

                const archiveInstrSql = `
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
                    WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                `;
                try {
                    await tx.executeOne(archiveInstrSql, [cleanUser, cleanYear, cleanSem]);
                } catch (e) {
                    console.warn('[deleteYearSem archiveInstr warning]', e?.message);
                }

                const deleteInstrSql = `
                    DELETE FROM RG_SCHEDULE_INSTRUCTOR 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteInstrSql, [cleanYear, cleanSem]);

                const archiveCourseSql = `
                    INSERT INTO RG_SCHEDULE_COURSE_HIS (
                        STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK,
                        INSERT_DATE, USER_INSERT,
                        INSERT_HIS_DATE, USER_INSERT_HIS
                    )
                    SELECT 
                        STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK,
                        INSERT_DATE, USER_INSERT,
                        SYSDATE, :1
                    FROM RG_SCHEDULE_COURSE
                    WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                `;
                try {
                    await tx.executeOne(archiveCourseSql, [cleanUser, cleanYear, cleanSem]);
                } catch (e) {
                    console.warn('[deleteYearSem archiveCourse warning]', e?.message);
                }

                const deleteCourseSql = `
                    DELETE FROM RG_SCHEDULE_COURSE 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteCourseSql, [cleanYear, cleanSem]);

                const deleteYearSemSql = `
                    DELETE FROM RG_SCHEDULE_YEARSEM 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteYearSemSql, [cleanYear, cleanSem]);
            });

            return res.status(200).json({
                success: true,
                message: `ลบข้อมูลปีการศึกษา ${cleanYear} ภาค ${cleanSem} พร้อมล้างข้อมูลตารางสอน อาจารย์ผู้สอน และวิชาที่เปิดสอนทั้งหมดเรียบร้อยแล้ว`
            });
        } catch (error) {
            console.error('[YearSemController.deleteYearSem error]', error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }
};

module.exports = YearSemController;
