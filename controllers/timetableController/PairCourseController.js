const SelectModel = require('../../models/db/SelectModel');
const InsertModel = require('../../models/db/InsertModel');
const DeleteModel = require('../../models/db/DeleteModel');
const DbTxModel = require('../../models/db/DbTxModel');

const PairCourseController = {
    async listPairCourses(req, res) {
        try {
            const sql = `
                SELECT 
                    p.PAIR_COURSE_GROUP_ID,
                    TRIM(p.COURSE_NO) AS COURSE_NO,
                    TRIM(p.START_YEAR) AS START_YEAR,
                    TRIM(p.STOP_YEAR) AS STOP_YEAR,
                    TRIM(p.YEAR_LEVEL) AS YEAR_LEVEL,
                    TRIM(p.SEMESTER) AS SEMESTER,
                    MAX(TRIM(u.COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                    MAX(TRIM(u.COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG_L,
                    MAX(u.CREDIT) AS CREDIT
                FROM RG_SCHEDULE_PAIR_COURSE p
                LEFT JOIN UGB_COURSE u ON TRIM(p.COURSE_NO) = TRIM(u.COURSE_NO)
                GROUP BY 
                    p.PAIR_COURSE_GROUP_ID,
                    TRIM(p.COURSE_NO),
                    TRIM(p.START_YEAR),
                    TRIM(p.STOP_YEAR),
                    TRIM(p.YEAR_LEVEL),
                    TRIM(p.SEMESTER)
                ORDER BY p.PAIR_COURSE_GROUP_ID DESC, TRIM(p.COURSE_NO) ASC
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const rows = (result && result.rows) ? result.rows : [];
            return res.status(200).json({ success: true, results: rows });
        } catch (error) {
            console.error('[PairCourseController.listPairCourses error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    async addPairGroup(req, res) {
        try {
            const { items } = req.body;
            if (!Array.isArray(items) || items.length < 2) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'การจับคู่วิชาต้องระบุวิชาตั้งแต่ 2 วิชาขึ้นไป' 
                });
            }

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!item.courseNo) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `กรุณาเลือกวิชาสำหรับวิชาคู่ที่ ${i + 1}` 
                    });
                }
            }

            let nextGroupId = 1;

            await DbTxModel.withTransaction(async (conn, tx) => {
                const maxGroupSql = `
                    SELECT NVL(MAX(PAIR_COURSE_GROUP_ID), 0) + 1 AS NEXT_ID 
                    FROM RG_SCHEDULE_PAIR_COURSE
                `;
                const maxRow = await tx.fetchOne(maxGroupSql, []);
                nextGroupId = Number(maxRow?.NEXT_ID || 1);

                for (const item of items) {
                    const cleanCourse = item.courseNo.toString().trim().toUpperCase();
                    const cleanStartYear = item.startYear ? item.startYear.toString().trim().substring(0, 2) : null;
                    const cleanStopYear = item.stopYear ? item.stopYear.toString().trim().substring(0, 2) : null;
                    const cleanYearLevel = item.yearLevel ? item.yearLevel.toString().trim().substring(0, 1) : '1';
                    const cleanSemester = item.semester ? item.semester.toString().trim().substring(0, 1) : '1';

                    const insertSql = `
                        INSERT INTO RG_SCHEDULE_PAIR_COURSE 
                        (PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER)
                        VALUES (:1, :2, :3, :4, :5, :6)
                    `;
                    await tx.executeOne(insertSql, [
                        nextGroupId,
                        cleanCourse,
                        cleanStartYear,
                        cleanStopYear,
                        cleanYearLevel,
                        cleanSemester
                    ]);
                }
            });

            return res.status(200).json({
                success: true,
                message: `บันทึกกลุ่มวิชาคู่ที่ ${nextGroupId} สำเร็จ (${items.length} วิชา)`,
                groupId: nextGroupId
            });
        } catch (error) {
            console.error('[PairCourseController.addPairGroup error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    async deletePairGroup(req, res) {
        try {
            const { groupId } = req.params;
            if (!groupId) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสกลุ่มวิชาคู่ที่ต้องการลบ' });
            }

            const cleanGroupId = Number(groupId);

            await DbTxModel.withTransaction(async (conn, tx) => {
                const archiveSql = `
                    INSERT INTO RG_SCHEDULE_PAIR_COURSE_HIS 
                    (PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER, INSERT_DATE)
                    SELECT PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER, SYSDATE
                    FROM RG_SCHEDULE_PAIR_COURSE
                    WHERE PAIR_COURSE_GROUP_ID = :1
                `;
                await tx.executeOne(archiveSql, [cleanGroupId]);

                const deleteSql = `
                    DELETE FROM RG_SCHEDULE_PAIR_COURSE 
                    WHERE PAIR_COURSE_GROUP_ID = :1
                `;
                await tx.executeOne(deleteSql, [cleanGroupId]);
            });

            return res.status(200).json({
                success: true,
                message: `ลบกลุ่มวิชาคู่ที่ ${cleanGroupId} สำเร็จ (จัดเก็บประวัติลง HIS เรียบร้อย)`
            });
        } catch (error) {
            console.error('[PairCourseController.deletePairGroup error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    async deletePairGroupsBulk(req, res) {
        try {
            const { groupIds } = req.body;
            if (!Array.isArray(groupIds) || groupIds.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรายการกลุ่มวิชาคู่ที่ต้องการลบ' });
            }

            let deletedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const gId of groupIds) {
                    const cleanGroupId = Number(gId);
                    if (isNaN(cleanGroupId)) continue;

                    const archiveSql = `
                        INSERT INTO RG_SCHEDULE_PAIR_COURSE_HIS 
                        (PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER, INSERT_DATE)
                        SELECT PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER, SYSDATE
                        FROM RG_SCHEDULE_PAIR_COURSE
                        WHERE PAIR_COURSE_GROUP_ID = :1
                    `;
                    await tx.executeOne(archiveSql, [cleanGroupId]);

                    const deleteSql = `
                        DELETE FROM RG_SCHEDULE_PAIR_COURSE 
                        WHERE PAIR_COURSE_GROUP_ID = :1
                    `;
                    await tx.executeOne(deleteSql, [cleanGroupId]);
                    deletedCount++;
                }
            });

            return res.status(200).json({
                success: true,
                message: `ลบกลุ่มวิชาคู่ (${deletedCount} กลุ่ม) สำเร็จ (จัดเก็บประวัติลง HIS เรียบร้อย)`,
                deletedCount
            });
        } catch (error) {
            console.error('[PairCourseController.deletePairGroupsBulk error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    async updatePairGroup(req, res) {
        try {
            const { groupId } = req.params;
            const { items } = req.body;
            if (!groupId) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสกลุ่มวิชาคู่ที่ต้องการแก้ไข' });
            }
            if (!Array.isArray(items) || items.length < 2) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'การจับคู่วิชาต้องระบุวิชาตั้งแต่ 2 วิชาขึ้นไป' 
                });
            }

            const cleanGroupId = Number(groupId);

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!item.courseNo) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `กรุณาเลือกวิชาสำหรับวิชาคู่ที่ ${i + 1}` 
                    });
                }
            }

            await DbTxModel.withTransaction(async (conn, tx) => {
                const archiveSql = `
                    INSERT INTO RG_SCHEDULE_PAIR_COURSE_HIS 
                    (PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER, INSERT_DATE)
                    SELECT PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER, SYSDATE
                    FROM RG_SCHEDULE_PAIR_COURSE
                    WHERE PAIR_COURSE_GROUP_ID = :1
                `;
                await tx.executeOne(archiveSql, [cleanGroupId]);

                const deleteSql = `
                    DELETE FROM RG_SCHEDULE_PAIR_COURSE 
                    WHERE PAIR_COURSE_GROUP_ID = :1
                `;
                await tx.executeOne(deleteSql, [cleanGroupId]);

                for (const item of items) {
                    const cleanCourse = item.courseNo.toString().trim().toUpperCase();
                    const cleanStartYear = item.startYear ? item.startYear.toString().trim().substring(0, 2) : null;
                    const cleanStopYear = item.stopYear ? item.stopYear.toString().trim().substring(0, 2) : null;
                    const cleanYearLevel = item.yearLevel ? item.yearLevel.toString().trim().substring(0, 1) : '1';
                    const cleanSemester = item.semester ? item.semester.toString().trim().substring(0, 1) : '1';

                    const insertSql = `
                        INSERT INTO RG_SCHEDULE_PAIR_COURSE 
                        (PAIR_COURSE_GROUP_ID, COURSE_NO, START_YEAR, STOP_YEAR, YEAR_LEVEL, SEMESTER)
                        VALUES (:1, :2, :3, :4, :5, :6)
                    `;
                    await tx.executeOne(insertSql, [
                        cleanGroupId,
                        cleanCourse,
                        cleanStartYear,
                        cleanStopYear,
                        cleanYearLevel,
                        cleanSemester
                    ]);
                }
            });

            return res.status(200).json({
                success: true,
                message: `แก้ไขกลุ่มวิชาคู่ที่ ${cleanGroupId} สำเร็จ (${items.length} วิชา)`,
                groupId: cleanGroupId
            });
        } catch (error) {
            console.error('[PairCourseController.updatePairGroup error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = PairCourseController;

