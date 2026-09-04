const SelectModel = require('../../models/db/SelectModel');
const InsertModel = require('../../models/db/InsertModel');
const UpdateModel = require('../../models/db/UpDateModel');
const DeleteModel = require('../../models/db/DeleteModel');
const DbTxModel = require('../../models/db/DbTxModel');

const YearSemController = {
    // 1. ดึงรายการปีภาคทั้งหมด (LIST)
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

    // 2. ดึงปีภาคปัจจุบันที่เปิดใช้งาน (ACTIVE SEMESTER)
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

    // 3. เพิ่มปีภาคใหม่ (ADD) + เช็คการกรอกปีภาคซ้ำ + บันทึก INSERT_DATE = SYSDATE, USER_INSERT
    async addYearSem(req, res) {
        try {
            const { studyYear, studySemester, studyActive, userInsert } = req.body;
            if (!studyYear || !studySemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีการศึกษาและภาคการศึกษา' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanUser = (userInsert || req.body.user || req.body.email || 'SYSTEM').toString().trim();
            const yearNum = parseInt(cleanYear, 10);

            // ตรวจสอบปีการศึกษาต้องไม่น้อยกว่า 2550
            if (isNaN(yearNum) || yearNum < 2550 || cleanYear.length !== 4) {
                return res.status(400).json({
                    success: false,
                    message: 'ปีการศึกษาต้องเป็นตัวเลข 4 หลัก และต้องไม่ต่ำกว่าปี 2550 (เช่น 2567, 2568...)'
                });
            }

            // ตรวจสอบภาคการศึกษา (เฉพาะภาค 1 และ ภาค 2)
            if (!['1', '2'].includes(cleanSem)) {
                return res.status(400).json({
                    success: false,
                    message: 'ภาคการศึกษาต้องเป็นภาค 1 หรือภาค 2 เท่านั้น'
                });
            }

            const cleanActive = (studyActive === '1' || studyActive === 1 || studyActive === true || studyActive === 'true') ? '1' : '0';

            await DbTxModel.withTransaction(async (conn, tx) => {
                // ตรวจสอบการกรอกปีภาคซ้ำ
                const checkSql = `
                    SELECT STUDY_YEAR, STUDY_SEMESTER 
                    FROM RG_SCHEDULE_YEARSEM 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                const checkResult = await tx.fetchAll(checkSql, [cleanYear, cleanSem]);
                if (checkResult && checkResult.length > 0) {
                    throw new Error(`ปีการศึกษา ${cleanYear} ภาคการศึกษาที่ ${cleanSem} มีอยู่ในระบบแล้ว`);
                }

                // ถ้ากำหนดให้เป็น active = '1' ให้เคลียร์รายการอื่นเป็น '0' ก่อน
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

    // 4. แก้ไขข้อมูลปีภาค (EDIT) + บันทึก INSERT_DATE = SYSDATE, USER_INSERT
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
            const cleanUser = (userInsert || req.body.user || req.body.email || 'SYSTEM').toString().trim();
            const yearNum = parseInt(nYear, 10);

            // ตรวจสอบปีการศึกษาใหม่ต้องไม่น้อยกว่า 2550
            if (isNaN(yearNum) || yearNum < 2550 || nYear.length !== 4) {
                return res.status(400).json({
                    success: false,
                    message: 'ปีการศึกษาต้องเป็นตัวเลข 4 หลัก และต้องไม่ต่ำกว่าปี 2550 (เช่น 2567, 2568...)'
                });
            }

            // ตรวจสอบภาคการศึกษา (เฉพาะภาค 1 และ ภาค 2)
            if (!['1', '2'].includes(nSem)) {
                return res.status(400).json({
                    success: false,
                    message: 'ภาคการศึกษาต้องเป็นภาค 1 หรือภาค 2 เท่านั้น'
                });
            }

            const cleanActive = (studyActive === '1' || studyActive === 1 || studyActive === true || studyActive === 'true') ? '1' : '0';

            await DbTxModel.withTransaction(async (conn, tx) => {
                // หากมีการเปลี่ยนปีหรือภาค ให้ตรวจเช็คว่าซ้ำกับรายการอื่นหรือไม่
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

                // ถ้ากำหนดให้เป็น active = '1' ให้เคลียร์รายการอื่นเป็น '0' ก่อน
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

    // 5. กำหนดปีภาคที่ใช้งาน (SET ACTIVE SEMESTER)
    async setActiveYearSem(req, res) {
        try {
            const { studyYear, studySemester } = req.body;
            if (!studyYear || !studySemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีการศึกษาและภาคการศึกษา' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 1. เคลียร์ทุกแถวในฐานข้อมูลเป็น '0'
                const resetSql = `UPDATE RG_SCHEDULE_YEARSEM SET STUDY_ACTIVE = '0'`;
                await tx.executeOne(resetSql, []);

                // 2. ตั้งแถวที่เลือกเป็น '1'
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

    // 6. ลบปีภาค (DELETE) -> Cascade ลบข้อมูลตารางสอน, กลุ่มอาจารย์ผู้สอน, รายชื่ออาจารย์, และวิชาที่เปิดสอนในปีภาคนั้นทั้งหมด พร้อมจัดเก็บประวัติลง HIS
    async deleteYearSem(req, res) {
        try {
            const { year, semester } = req.params;
            if (!year || !semester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีการศึกษาและภาคการศึกษาที่ต้องการลบ' });
            }

            const cleanYear = year.toString().trim();
            const cleanSem = semester.toString().trim();
            const cleanUser = (req.body?.userInsert || req.query?.userInsert || 'ADMIN').toString().trim();

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 1. สำรองข้อมูลตารางสอน RG_SCHEDULE_CLASS -> RG_SCHEDULE_CLASS_HIS
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

                // 2. ลบข้อมูลตารางสอน RG_SCHEDULE_CLASS
                const deleteClassSql = `
                    DELETE FROM RG_SCHEDULE_CLASS 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteClassSql, [cleanYear, cleanSem]);

                // 3. สำรองข้อมูลการสอน RG_SCHEDULE_TEACH -> RG_SCHEDULE_TEACH_HIS
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

                // 4. ลบข้อมูลการสอน RG_SCHEDULE_TEACH
                const deleteTeachSql = `
                    DELETE FROM RG_SCHEDULE_TEACH 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteTeachSql, [cleanYear, cleanSem]);

                // 5. สำรองข้อมูลรายชื่ออาจารย์ RG_SCHEDULE_INSTRUCTOR -> RG_SCHEDULE_INSTRUCTOR_HIS
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

                // 6. ลบข้อมูลรายชื่ออาจารย์ RG_SCHEDULE_INSTRUCTOR
                const deleteInstrSql = `
                    DELETE FROM RG_SCHEDULE_INSTRUCTOR 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteInstrSql, [cleanYear, cleanSem]);

                // 7. นำวิชาที่เปิดสอนในปีภาคนี้ทั้งหมดไปสำรองไว้ใน RG_SCHEDULE_COURSE_HIS ก่อนลบ
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

                // 8. ลบวิชาทั้งหมดที่อยู่ในปีภาคนี้ออกจาก RG_SCHEDULE_COURSE
                const deleteCourseSql = `
                    DELETE FROM RG_SCHEDULE_COURSE 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `;
                await tx.executeOne(deleteCourseSql, [cleanYear, cleanSem]);

                // 9. ลบปีภาคออกจาก RG_SCHEDULE_YEARSEM
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
            return res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = YearSemController;
