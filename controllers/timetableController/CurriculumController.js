const SelectModel = require('../../models/db/SelectModel');
const InsertModel = require('../../models/db/InsertModel');
const DeleteModel = require('../../models/db/DeleteModel');
const DbTxModel = require('../../models/db/DbTxModel');

const CurriculumController = {
    // 1. ดึงรายชื่อคณะทั้งหมดจาก UGB_FACULTY
    async getFaculties(req, res) {
        try {
            const sql = `
                SELECT 
                    TRIM(FACULTY_NO) AS FACULTY_NO,
                    TRIM(FACULTY_NAME_THAI) AS FACULTY_NAME_THAI,
                    TRIM(FACULTY_NAME_SHORT) AS FACULTY_NAME_SHORT,
                    TRIM(FACULTY_NAME_ENG) AS FACULTY_NAME_ENG
                FROM UGB_FACULTY
                ORDER BY FACULTY_NO ASC
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const rows = (result && result.rows) ? result.rows : [];
            return res.status(200).json({ success: true, results: rows });
        } catch (error) {
            console.error('[CurriculumController.getFaculties error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 2. ดึงกลุ่มวิชาตามคณะจาก UGB_PROGRAM_GROUP_RU30
    async getGroupsByFaculty(req, res) {
        try {
            const { facultyNo } = req.params;
            if (!facultyNo) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสคณะ', results: [] });
            }

            const cleanFac = facultyNo.toString().trim();
            const sql = `
                SELECT 
                    TRIM(FACULTY_NO) AS FACULTY_NO,
                    TRIM(GROUP_NO) AS GROUP_NO,
                    TRIM(GROUP_NAME) AS GROUP_NAME
                FROM UGB_PROGRAM_GROUP_RU30
                WHERE TRIM(FACULTY_NO) = :1
                ORDER BY GROUP_NO ASC
            `;
            const result = await SelectModel.findAll(res, sql, [cleanFac]);
            const rows = (result && result.rows) ? result.rows : [];
            return res.status(200).json({ success: true, results: rows });
        } catch (error) {
            console.error('[CurriculumController.getGroupsByFaculty error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 3. ดึงกลุ่มวิชาย่อยตามคณะและกลุ่มวิชาจาก UGB_PROGRAM_SUB_GROUP_RU30
    async getSubGroups(req, res) {
        try {
            const { facultyNo, groupNo } = req.params;
            if (!facultyNo || !groupNo) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสคณะและรหัสกลุ่มวิชา', results: [] });
            }

            const cleanFac = facultyNo.toString().trim();
            const cleanGrp = groupNo.toString().trim();
            const sql = `
                SELECT 
                    TRIM(FACULTY_NO) AS FACULTY_NO,
                    TRIM(GROUP_NO) AS GROUP_NO,
                    TRIM(SUB_GROUP_NO) AS SUB_GROUP_NO,
                    TRIM(SUB_GROUP_NAME) AS SUB_GROUP_NAME
                FROM UGB_PROGRAM_SUB_GROUP_RU30
                WHERE TRIM(FACULTY_NO) = :1 AND TRIM(GROUP_NO) = :2
                ORDER BY SUB_GROUP_NO ASC
            `;
            const result = await SelectModel.findAll(res, sql, [cleanFac, cleanGrp]);
            const rows = (result && result.rows) ? result.rows : [];
            return res.status(200).json({ success: true, results: rows });
        } catch (error) {
            console.error('[CurriculumController.getSubGroups error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 4. ดึงรายการวิชาในหลักสูตรทั้งหมด (RG_SCHEDULE_CURRICULUM พร้อมข้อมูล Join)
    async listCurriculumCourses(req, res) {
        try {
            const { facultyNo, groupNo, subGroupNo, yearLevel, semester, search } = req.query;

            let conditions = ['1=1'];
            let binds = [];

            if (facultyNo && facultyNo !== 'ALL') {
                binds.push(facultyNo.toString().trim());
                conditions.push(`TRIM(c.FACULTY_NO) = :${binds.length}`);
            }

            if (groupNo && groupNo !== 'ALL') {
                binds.push(groupNo.toString().trim());
                conditions.push(`TRIM(c.GROUP_NO) = :${binds.length}`);
            }

            if (subGroupNo && subGroupNo !== 'ALL') {
                binds.push(subGroupNo.toString().trim());
                conditions.push(`TRIM(c.SUB_GROUP_NO) = :${binds.length}`);
            }

            if (yearLevel && yearLevel !== 'ALL') {
                binds.push(yearLevel.toString().trim());
                conditions.push(`TRIM(c.YEAR_LEVEL) = :${binds.length}`);
            }

            if (semester && semester !== 'ALL') {
                binds.push(semester.toString().trim());
                conditions.push(`TRIM(c.SEMESTER) = :${binds.length}`);
            }

            if (search && search.toString().trim()) {
                const s = `%${search.toString().trim().toUpperCase()}%`;
                binds.push(s);
                const bindIdx = binds.length;
                conditions.push(`(
                    UPPER(TRIM(c.COURSE_NO)) LIKE :${bindIdx} OR 
                    UPPER(TRIM(u.COURSE_NAME_THAI)) LIKE :${bindIdx} OR 
                    UPPER(TRIM(u.COURSE_NAME_ENG_L)) LIKE :${bindIdx} OR
                    UPPER(TRIM(g.GROUP_NAME)) LIKE :${bindIdx} OR
                    UPPER(TRIM(sg.SUB_GROUP_NAME)) LIKE :${bindIdx}
                )`);
            }

            const sql = `
                SELECT 
                    TRIM(c.FACULTY_NO) AS FACULTY_NO,
                    TRIM(c.GROUP_NO) AS GROUP_NO,
                    TRIM(c.SUB_GROUP_NO) AS SUB_GROUP_NO,
                    TRIM(c.YEAR_LEVEL) AS YEAR_LEVEL,
                    TRIM(c.SEMESTER) AS SEMESTER,
                    TRIM(c.COURSE_NO) AS COURSE_NO,
                    TRIM(c.YEAR_ENROLL) AS YEAR_ENROLL,
                    MAX(TRIM(f.FACULTY_NAME_THAI)) AS FACULTY_NAME_THAI,
                    MAX(TRIM(f.FACULTY_NAME_SHORT)) AS FACULTY_NAME_SHORT,
                    MAX(TRIM(g.GROUP_NAME)) AS GROUP_NAME,
                    MAX(TRIM(sg.SUB_GROUP_NAME)) AS SUB_GROUP_NAME,
                    MAX(TRIM(u.COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                    MAX(TRIM(u.COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG_L,
                    MAX(u.CREDIT) AS CREDIT
                FROM RG_SCHEDULE_CURRICULUM c
                LEFT JOIN UGB_FACULTY f ON TRIM(c.FACULTY_NO) = TRIM(f.FACULTY_NO)
                LEFT JOIN UGB_PROGRAM_GROUP_RU30 g ON TRIM(c.FACULTY_NO) = TRIM(g.FACULTY_NO) AND TRIM(c.GROUP_NO) = TRIM(g.GROUP_NO)
                LEFT JOIN UGB_PROGRAM_SUB_GROUP_RU30 sg ON TRIM(c.FACULTY_NO) = TRIM(sg.FACULTY_NO) AND TRIM(c.GROUP_NO) = TRIM(sg.GROUP_NO) AND TRIM(c.SUB_GROUP_NO) = TRIM(sg.SUB_GROUP_NO)
                LEFT JOIN UGB_COURSE u ON TRIM(c.COURSE_NO) = TRIM(u.COURSE_NO)
                WHERE ${conditions.join(' AND ')}
                GROUP BY 
                    TRIM(c.FACULTY_NO),
                    TRIM(c.GROUP_NO),
                    TRIM(c.SUB_GROUP_NO),
                    TRIM(c.YEAR_LEVEL),
                    TRIM(c.SEMESTER),
                    TRIM(c.COURSE_NO),
                    TRIM(c.YEAR_ENROLL)
                ORDER BY 
                    TRIM(c.FACULTY_NO) ASC,
                    TRIM(c.GROUP_NO) ASC,
                    TRIM(c.SUB_GROUP_NO) ASC,
                    TRIM(c.YEAR_LEVEL) ASC,
                    TRIM(c.SEMESTER) ASC,
                    TRIM(c.COURSE_NO) ASC
            `;

            const result = await SelectModel.findAll(res, sql, binds);
            const rows = (result && result.rows) ? result.rows : [];
            return res.status(200).json({ success: true, results: rows });
        } catch (error) {
            console.error('[CurriculumController.listCurriculumCourses error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 5. เพิ่มวิชาในหลักสูตร (ADD / BULK ADD พร้อมเช็คการบันทึกซ้ำ)
    async addCurriculumCourses(req, res) {
        try {
            const { facultyNo, groupNo, subGroupNo, yearLevel, semester, yearEnroll, courseNos } = req.body;

            if (!facultyNo || !groupNo || !yearLevel || !semester) {
                return res.status(400).json({
                    success: false,
                    message: 'กรุณากรอกข้อมูลคณะ, กลุ่มวิชา, ชั้นปี และภาคการศึกษาให้ครบถ้วน'
                });
            }

            if (!Array.isArray(courseNos) || courseNos.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'กรุณาระบุรายวิชาที่ต้องการเพิ่มอย่างน้อย 1 วิชา'
                });
            }

            const cleanFac = facultyNo.toString().trim();
            const cleanGrp = groupNo.toString().trim();
            const cleanSubGrp = (subGroupNo && subGroupNo.toString().trim()) ? subGroupNo.toString().trim() : '00';
            const cleanYearLevel = yearLevel.toString().trim().substring(0, 1);
            const cleanSemester = semester.toString().trim().substring(0, 1);
            const cleanYearEnroll = (yearEnroll && yearEnroll.toString().trim()) ? yearEnroll.toString().trim().substring(0, 2) : null;
            const coursesToAdd = Array.from(new Set(rawCourses.map(c => c.toString().trim().toUpperCase()).filter(Boolean)));
            let addedCount = 0;
            let skippedCount = 0;
            const addedCourses = [];
            const skippedCourses = [];

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const cleanCourse of coursesToAdd) {
                    // ตรวจสอบว่าวิชานี้มีอยู่ในหลักสูตรนี้แล้วหรือไม่
                    const checkSql = `
                        SELECT COUNT(*) AS CNT 
                        FROM RG_SCHEDULE_CURRICULUM 
                        WHERE TRIM(FACULTY_NO) = :1 
                          AND TRIM(GROUP_NO) = :2 
                          AND NVL(TRIM(SUB_GROUP_NO), '00') = :3 
                          AND TRIM(YEAR_LEVEL) = :4 
                          AND TRIM(SEMESTER) = :5 
                          AND UPPER(TRIM(COURSE_NO)) = :6
                    `;
                    const checkRes = await tx.fetchOne(checkSql, [
                        cleanFac,
                        cleanGrp,
                        cleanSubGrp,
                        cleanYearLevel,
                        cleanSemester,
                        cleanCourse
                    ]);

                    const cnt = Number(checkRes?.CNT || 0);

                    if (cnt > 0) {
                        skippedCount++;
                        skippedCourses.push(cleanCourse);
                        continue;
                    }

                    // บันทึกลงตาราง RG_SCHEDULE_CURRICULUM
                    const insertSql = `
                        INSERT INTO RG_SCHEDULE_CURRICULUM 
                        (FACULTY_NO, GROUP_NO, SUB_GROUP_NO, YEAR_LEVEL, SEMESTER, COURSE_NO, YEAR_ENROLL)
                        VALUES (:1, :2, :3, :4, :5, :6, :7)
                    `;
                    await tx.executeOne(insertSql, [
                        cleanFac,
                        cleanGrp,
                        cleanSubGrp,
                        cleanYearLevel,
                        cleanSemester,
                        cleanCourse,
                        cleanYearEnroll
                    ]);

                    addedCount++;
                    addedCourses.push(cleanCourse);
                }
            });

            let message = '';
            if (addedCount > 0 && skippedCount === 0) {
                message = `บันทึกวิชาในหลักสูตรสำเร็จ ${addedCount} วิชา`;
            } else if (addedCount > 0 && skippedCount > 0) {
                message = `บันทึกสำเร็จ ${addedCount} วิชา (ข้ามวิชาที่ซ้ำ ${skippedCount} วิชา: ${skippedCourses.join(', ')})`;
            } else {
                message = `วิชาที่เลือกมีอยู่ในหลักสูตรแล้วทั้งหมด (${skippedCourses.join(', ')})`;
            }

            return res.status(200).json({
                success: true,
                message,
                addedCount,
                skippedCount,
                addedCourses,
                skippedCourses
            });
        } catch (error) {
            console.error('[CurriculumController.addCurriculumCourses error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // 6. ลบวิชาในหลักสูตร (DELETE -> ย้ายเข้า RG_SCHEDULE_CURRICULUM_HIS ก่อนลบ)
    async deleteCurriculumCourse(req, res) {
        try {
            const { facultyNo, groupNo, subGroupNo, yearLevel, semester, courseNo } = req.body;

            if (!facultyNo || !groupNo || !yearLevel || !semester || !courseNo) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุข้อมูลวิชาที่ต้องการลบให้ครบถ้วน' });
            }

            const cleanFac = facultyNo.toString().trim();
            const cleanGrp = groupNo.toString().trim();
            const cleanSubGrp = (subGroupNo && subGroupNo.toString().trim()) ? subGroupNo.toString().trim() : '00';
            const cleanYearLevel = yearLevel.toString().trim().substring(0, 1);
            const cleanSemester = semester.toString().trim().substring(0, 1);
            const cleanCourse = courseNo.toString().trim().toUpperCase();

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 1. สำรองข้อมูลเข้า RG_SCHEDULE_CURRICULUM_HIS พร้อม INSERT_DATE = SYSDATE
                const archiveSql = `
                    INSERT INTO RG_SCHEDULE_CURRICULUM_HIS 
                    (FACULTY_NO, GROUP_NO, SUB_GROUP_NO, YEAR_LEVEL, SEMESTER, COURSE_NO, YEAR_ENROLL, INSERT_DATE)
                    SELECT FACULTY_NO, GROUP_NO, SUB_GROUP_NO, YEAR_LEVEL, SEMESTER, COURSE_NO, YEAR_ENROLL, SYSDATE
                    FROM RG_SCHEDULE_CURRICULUM
                    WHERE TRIM(FACULTY_NO) = :1 
                      AND TRIM(GROUP_NO) = :2 
                      AND NVL(TRIM(SUB_GROUP_NO), '00') = :3 
                      AND TRIM(YEAR_LEVEL) = :4 
                      AND TRIM(SEMESTER) = :5 
                      AND UPPER(TRIM(COURSE_NO)) = :6
                `;
                await tx.executeOne(archiveSql, [
                    cleanFac,
                    cleanGrp,
                    cleanSubGrp,
                    cleanYearLevel,
                    cleanSemester,
                    cleanCourse
                ]);

                // 2. ลบออกจาก RG_SCHEDULE_CURRICULUM
                const deleteSql = `
                    DELETE FROM RG_SCHEDULE_CURRICULUM 
                    WHERE TRIM(FACULTY_NO) = :1 
                      AND TRIM(GROUP_NO) = :2 
                      AND NVL(TRIM(SUB_GROUP_NO), '00') = :3 
                      AND TRIM(YEAR_LEVEL) = :4 
                      AND TRIM(SEMESTER) = :5 
                      AND UPPER(TRIM(COURSE_NO)) = :6
                `;
                await tx.executeOne(deleteSql, [
                    cleanFac,
                    cleanGrp,
                    cleanSubGrp,
                    cleanYearLevel,
                    cleanSemester,
                    cleanCourse
                ]);
            });

            return res.status(200).json({
                success: true,
                message: `ลบวิชา ${cleanCourse} ออกจากหลักสูตรสำเร็จ (จัดเก็บประวัติลง HIS เรียบร้อย)`
            });
        } catch (error) {
            console.error('[CurriculumController.deleteCurriculumCourse error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // 7. ลบหลายวิชาในหลักสูตรพร้อมกัน (BULK DELETE)
    async deleteCurriculumBulk(req, res) {
        try {
            const { items } = req.body;
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรายการวิชาที่ต้องการลบ' });
            }

            let deletedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const item of items) {
                    const cleanFac = item.facultyNo ? item.facultyNo.toString().trim() : '';
                    const cleanGrp = item.groupNo ? item.groupNo.toString().trim() : '';
                    const cleanSubGrp = (item.subGroupNo && item.subGroupNo.toString().trim()) ? item.subGroupNo.toString().trim() : '00';
                    const cleanYearLevel = item.yearLevel ? item.yearLevel.toString().trim().substring(0, 1) : '';
                    const cleanSemester = item.semester ? item.semester.toString().trim().substring(0, 1) : '';
                    const cleanCourse = item.courseNo ? item.courseNo.toString().trim().toUpperCase() : '';

                    if (!cleanFac || !cleanGrp || !cleanCourse) continue;

                    // 1. สำรองข้อมูลเข้า HIS
                    const archiveSql = `
                        INSERT INTO RG_SCHEDULE_CURRICULUM_HIS 
                        (FACULTY_NO, GROUP_NO, SUB_GROUP_NO, YEAR_LEVEL, SEMESTER, COURSE_NO, YEAR_ENROLL, INSERT_DATE)
                        SELECT FACULTY_NO, GROUP_NO, SUB_GROUP_NO, YEAR_LEVEL, SEMESTER, COURSE_NO, YEAR_ENROLL, SYSDATE
                        FROM RG_SCHEDULE_CURRICULUM
                        WHERE TRIM(FACULTY_NO) = :1 
                          AND TRIM(GROUP_NO) = :2 
                          AND NVL(TRIM(SUB_GROUP_NO), '00') = :3 
                          AND TRIM(YEAR_LEVEL) = :4 
                          AND TRIM(SEMESTER) = :5 
                          AND UPPER(TRIM(COURSE_NO)) = :6
                    `;
                    await tx.executeOne(archiveSql, [
                        cleanFac,
                        cleanGrp,
                        cleanSubGrp,
                        cleanYearLevel,
                        cleanSemester,
                        cleanCourse
                    ]);

                    // 2. ลบออกจากตารางหลัก
                    const deleteSql = `
                        DELETE FROM RG_SCHEDULE_CURRICULUM 
                        WHERE TRIM(FACULTY_NO) = :1 
                          AND TRIM(GROUP_NO) = :2 
                          AND NVL(TRIM(SUB_GROUP_NO), '00') = :3 
                          AND TRIM(YEAR_LEVEL) = :4 
                          AND TRIM(SEMESTER) = :5 
                          AND UPPER(TRIM(COURSE_NO)) = :6
                    `;
                    await tx.executeOne(deleteSql, [
                        cleanFac,
                        cleanGrp,
                        cleanSubGrp,
                        cleanYearLevel,
                        cleanSemester,
                        cleanCourse
                    ]);

                    deletedCount++;
                }
            });

            return res.status(200).json({
                success: true,
                message: `ลบวิชาในหลักสูตรสำเร็จ ${deletedCount} วิชา (จัดเก็บประวัติลง HIS เรียบร้อย)`,
                deletedCount
            });
        } catch (error) {
            console.error('[CurriculumController.deleteCurriculumBulk error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = CurriculumController;
