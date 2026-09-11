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

const CourseController = {
    // 1. ดึงรายการวิชาที่เปิดสอนตามปี/ภาค (LIST)
    async listCourses(req, res) {
        try {
            let { year, semester } = req.query;

            // หากไม่ได้ระบุปีภาค ให้ดึงปีภาคที่ Active มาเป็นค่าเริ่มต้น
            if (!year || !semester) {
                const activeSql = `SELECT TRIM(STUDY_YEAR) AS STUDY_YEAR, TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER FROM RG_SCHEDULE_YEARSEM WHERE TRIM(STUDY_ACTIVE) = '1' AND ROWNUM = 1`;
                const activeRes = await SelectModel.findAll(res, activeSql, []);
                if (activeRes.rows && activeRes.rows.length > 0) {
                    year = activeRes.rows[0].STUDY_YEAR;
                    semester = activeRes.rows[0].STUDY_SEMESTER;
                } else {
                    year = '2569';
                    semester = '1';
                }
            }

            const cleanYear = year.toString().trim();
            const cleanSem = semester.toString().trim();

            const sql = `
                SELECT 
                    TRIM(c.STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(c.STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(c.COURSE_NO) AS COURSE_NO,
                    TRIM(c.COURSE_REMARK) AS COURSE_REMARK,
                    TO_CHAR(c.INSERT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS INSERT_DATE,
                    TRIM(c.USER_INSERT) AS USER_INSERT,
                    TRIM(u.COURSE_NAME_THAI) AS COURSE_NAME_THAI,
                    TRIM(u.COURSE_NAME_ENG_L) AS COURSE_NAME_ENG_L,
                    u.CREDIT,
                    NVL(sch.SCHEDULE_COUNT, 0) AS SCHEDULE_COUNT
                FROM RG_SCHEDULE_COURSE c
                LEFT JOIN (
                    SELECT 
                        TRIM(COURSE_NO) AS COURSE_NO,
                        MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                        MAX(TRIM(COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG_L,
                        MAX(CREDIT) AS CREDIT
                    FROM UGB_COURSE
                    GROUP BY TRIM(COURSE_NO)
                ) u ON TRIM(c.COURSE_NO) = u.COURSE_NO
                LEFT JOIN (
                    SELECT 
                        UPPER(TRIM(COURSE_NO)) AS COURSE_NO,
                        COUNT(DISTINCT DAY_CODE || '_' || TIME_CODE || '_' || NVL(ROOM_CODE, '-')) AS SCHEDULE_COUNT
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    GROUP BY UPPER(TRIM(COURSE_NO))
                ) sch ON UPPER(TRIM(c.COURSE_NO)) = sch.COURSE_NO
                WHERE TRIM(c.STUDY_YEAR) = :1 AND TRIM(c.STUDY_SEMESTER) = :2
                ORDER BY c.COURSE_NO ASC
            `;

            const result = await SelectModel.findAll(res, sql, [cleanYear, cleanSem]);
            const rows = (result.rows ?? []).map(r => ({
                ...r,
                SCHEDULE_COUNT: Number(r.SCHEDULE_COUNT || 0),
                IS_SCHEDULED: Number(r.SCHEDULE_COUNT || 0) > 0,
            }));

            return res.status(200).json({
                success: true,
                message: '',
                currentYear: cleanYear,
                currentSemester: cleanSem,
                results: rows
            });
        } catch (error) {
            console.error('[CourseController.listCourses error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 2. ดึงตัวอักษรตัวแรกของรหัสวิชาทั้งหมด (A, B, C...) จาก UGB_COURSE
    async getFirstLetters(req, res) {
        try {
            const sql = `
                SELECT DISTINCT UPPER(SUBSTR(TRIM(COURSE_NO), 1, 1)) AS FIRST_LETTER
                FROM UGB_COURSE
                WHERE REGEXP_LIKE(TRIM(COURSE_NO), '^[A-Za-z]')
                ORDER BY FIRST_LETTER ASC
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const letters = (result.rows ?? []).map(r => r.FIRST_LETTER);
            return res.status(200).json({ success: true, results: letters });
        } catch (error) {
            console.error('[CourseController.getFirstLetters error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 3. ดึงกลุ่มรหัสวิชาตามตัวอักษรแรก (เช่น A -> ACC, ANT, APR...) จาก UGB_COURSE
    async getPrefixGroups(req, res) {
        try {
            const { letter } = req.params;
            if (!letter) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุตัวอักษร' });
            }

            const cleanLetter = letter.trim().toUpperCase();
            const sql = `
                SELECT DISTINCT UPPER(REGEXP_SUBSTR(TRIM(COURSE_NO), '^[A-Za-z]+')) AS PREFIX_GROUP
                FROM UGB_COURSE
                WHERE UPPER(TRIM(COURSE_NO)) LIKE :1 || '%'
                ORDER BY PREFIX_GROUP ASC
            `;
            const result = await SelectModel.findAll(res, sql, [cleanLetter]);
            const prefixes = (result.rows ?? []).map(r => r.PREFIX_GROUP).filter(Boolean);

            return res.status(200).json({ success: true, results: prefixes });
        } catch (error) {
            console.error('[CourseController.getPrefixGroups error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 4. ดึงรายวิชาจาก UGB_COURSE ตามกลุ่มตัวอักษร หรือคำค้นหาแยกตามรหัสวิชา/ชื่อวิชา
    async getCoursesByPrefix(req, res) {
        try {
            const { prefix, query, code, name } = req.query;
            let sql = '';
            let params = [];

            if (code || name || query) {
                let whereClauses = [];

                if (code && code.trim()) {
                    whereClauses.push(`UPPER(TRIM(COURSE_NO)) LIKE '%' || :${params.length + 1} || '%'`);
                    params.push(code.trim().toUpperCase());
                }
                if (name && name.trim()) {
                    const cleanName = name.trim().toUpperCase();
                    whereClauses.push(`(UPPER(TRIM(COURSE_NAME_THAI)) LIKE '%' || :${params.length + 1} || '%' OR UPPER(TRIM(COURSE_NAME_ENG_L)) LIKE '%' || :${params.length + 2} || '%')`);
                    params.push(cleanName, cleanName);
                }
                if (query && query.trim() && !code && !name) {
                    const cleanQ = query.trim().toUpperCase();
                    whereClauses.push(`(UPPER(TRIM(COURSE_NO)) LIKE '%' || :1 || '%' OR UPPER(TRIM(COURSE_NAME_THAI)) LIKE '%' || :2 || '%' OR UPPER(TRIM(COURSE_NAME_ENG_L)) LIKE '%' || :3 || '%')`);
                    params.push(cleanQ, cleanQ, cleanQ);
                }

                sql = `
                    SELECT 
                        TRIM(COURSE_NO) AS COURSE_NO,
                        MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                        MAX(TRIM(COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG_L,
                        MAX(CREDIT) AS CREDIT
                    FROM UGB_COURSE
                    WHERE ${whereClauses.join(' AND ')}
                    GROUP BY TRIM(COURSE_NO)
                    ORDER BY COURSE_NO ASC
                `;
            } else if (prefix && prefix.trim()) {
                const cleanPrefix = prefix.trim().toUpperCase();
                sql = `
                    SELECT 
                        TRIM(COURSE_NO) AS COURSE_NO,
                        MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                        MAX(TRIM(COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG_L,
                        MAX(CREDIT) AS CREDIT
                    FROM UGB_COURSE
                    WHERE UPPER(TRIM(COURSE_NO)) LIKE :1 || '%'
                    GROUP BY TRIM(COURSE_NO)
                    ORDER BY COURSE_NO ASC
                `;
                params = [cleanPrefix];
            } else {
                return res.status(400).json({ success: false, message: 'กรุณาระบุกลุ่มวิชาหรือคำค้นหา' });
            }

            const result = await SelectModel.findAll(res, sql, params);
            const courses = result.rows ?? [];

            return res.status(200).json({ success: true, results: courses });
        } catch (error) {
            console.error('[CourseController.getCoursesByPrefix error]', error);
            return res.status(500).json({ success: false, message: error.message, results: [] });
        }
    },

    // 5. เพิ่มวิชาที่เปิดสอน (ADD / BULK ADD) + เช็คซ้ำ
    async addCourse(req, res) {
        try {
            const { studyYear, studySemester, courseNo, courseNos, courseRemark, userInsert } = req.body;
            if (!studyYear || !studySemester) {
                return res.status(400).json({ success: false, message: 'กรุณากรอกปีการศึกษาและภาคการศึกษา' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanRemark = courseRemark ? courseRemark.toString().trim() : null;
            const cleanUser = sanitizeUsername(userInsert || req.body?.user || req.body?.email || req.headers?.['x-user'], 'SYSTEM');

            // ตรวจสอบว่ามีปีและภาคการศึกษานี้อยู่ในตาราง RG_SCHEDULE_YEARSEM หรือไม่ (ห้ามเพิ่มวิชาหากไม่มีปีภาค)
            const yearSemCheckSql = `
                SELECT STUDY_YEAR, STUDY_SEMESTER
                FROM RG_SCHEDULE_YEARSEM
                WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
            `;
            const yearSemCheckRes = await SelectModel.findAll(res, yearSemCheckSql, [cleanYear, cleanSem]);
            if (!yearSemCheckRes.rows || yearSemCheckRes.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `ไม่พบปีการศึกษา ${cleanYear} ภาค ${cleanSem} ในระบบ กรุณาเพิ่มปีภาคการศึกษาก่อนบันทึกรายวิชา`
                });
            }

            // Gather all course numbers to add
            let rawList = [];
            if (Array.isArray(courseNos) && courseNos.length > 0) {
                rawList = courseNos;
            } else if (courseNo) {
                rawList = [courseNo];
            }

            if (rawList.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาเลือกวิชาที่ต้องการเพิ่มอย่างน้อย 1 วิชา' });
            }

            const coursesToAdd = Array.from(new Set(rawList.map(c => c.toString().trim().toUpperCase()).filter(Boolean)));
            const added = [];
            const skippedDuplicates = [];

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const cNo of coursesToAdd) {
                    // ตรวจสอบการบันทึกซ้ำใน RG_SCHEDULE_COURSE ภายใต้ Transaction
                    const checkSql = `
                        SELECT COURSE_NO 
                        FROM RG_SCHEDULE_COURSE 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(COURSE_NO) = :3
                    `;
                    const existing = await tx.fetchOne(checkSql, [cleanYear, cleanSem, cNo]);
                    if (existing) {
                        skippedDuplicates.push(cNo);
                        continue;
                    }

                    const insertSql = `
                        INSERT INTO RG_SCHEDULE_COURSE (
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK,
                            INSERT_DATE, USER_INSERT
                        ) VALUES (:1, :2, :3, :4, SYSDATE, :5)
                    `;
                    await tx.executeOne(insertSql, [cleanYear, cleanSem, cNo, cleanRemark, cleanUser]);
                    added.push(cNo);
                }
            });

            if (added.length === 0 && skippedDuplicates.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `วิชาที่เลือก (${skippedDuplicates.join(', ')}) ในปีการศึกษา ${cleanYear} ภาค ${cleanSem} มีอยู่ในระบบแล้ว`
                });
            }

            let msg = `เพิ่มวิชา (${added.length} วิชา) ประจำปี ${cleanYear} ภาค ${cleanSem} สำเร็จ`;
            if (skippedDuplicates.length > 0) {
                msg += ` (ข้ามวิชาที่ซ้ำ: ${skippedDuplicates.join(', ')})`;
            }

            return res.status(200).json({
                success: true,
                message: msg,
                addedCount: added.length,
                skippedCount: skippedDuplicates.length,
                addedCourses: added,
                skippedCourses: skippedDuplicates
            });
        } catch (error) {
            console.error('[CourseController.addCourse error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // 6. แก้ไขข้อมูลวิชาที่เปิดสอน (EDIT)
    async updateCourse(req, res) {
        try {
            const { studyYear, studySemester, oldCourseNo, newCourseNo, courseRemark, userInsert } = req.body;
            if (!studyYear || !studySemester || !oldCourseNo || !newCourseNo) {
                return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanOldCourse = oldCourseNo.toString().trim().toUpperCase();
            const cleanNewCourse = (newCourseNo || courseNo).toString().trim().toUpperCase();
            const cleanRemark = courseRemark ? courseRemark.toString().trim() : null;
            const cleanUser = sanitizeUsername(userInsert || req.body?.user || req.body?.email || req.headers?.['x-user'], 'SYSTEM');

            await DbTxModel.withTransaction(async (conn, tx) => {
                // หากเปลี่ยนรหัสวิชา ให้ตรวจเช็คว่าซ้ำหรือไม่
                if (cleanOldCourse !== cleanNewCourse) {
                    const checkSql = `
                        SELECT COURSE_NO 
                        FROM RG_SCHEDULE_COURSE 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(COURSE_NO) = :3
                    `;
                    const existing = await tx.fetchOne(checkSql, [cleanYear, cleanSem, cleanNewCourse]);
                    if (existing) {
                        throw new Error(`รหัสวิชา ${cleanNewCourse} ในปีการศึกษา ${cleanYear} ภาคการศึกษาที่ ${cleanSem} มีอยู่ในระบบแล้ว`);
                    }
                }

                const updateSql = `
                    UPDATE RG_SCHEDULE_COURSE 
                    SET COURSE_NO = :1,
                        COURSE_REMARK = :2,
                        INSERT_DATE = SYSDATE,
                        USER_INSERT = :3
                    WHERE TRIM(STUDY_YEAR) = :4 AND TRIM(STUDY_SEMESTER) = :5 AND TRIM(COURSE_NO) = :6
                `;
                const result = await tx.executeOne(updateSql, [cleanNewCourse, cleanRemark, cleanUser, cleanYear, cleanSem, cleanOldCourse]);
                if (result.rowsAffected === 0) {
                    throw new Error('ไม่พบข้อมูลวิชาที่ต้องการแก้ไข');
                }
            });

            return res.status(200).json({
                success: true,
                message: `แก้ไขวิชา ${cleanNewCourse} สำเร็จ`,
                results: { 
                    STUDY_YEAR: cleanYear, 
                    STUDY_SEMESTER: cleanSem, 
                    COURSE_NO: cleanNewCourse, 
                    COURSE_REMARK: cleanRemark,
                    USER_INSERT: cleanUser
                }
            });
        } catch (error) {
            console.error('[CourseController.updateCourse error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // 7. ลบวิชาที่เปิดสอน (DELETE) -> ย้ายข้อมูลเข้า RG_SCHEDULE_COURSE_HIS ก่อนลบ
    async deleteCourse(req, res) {
        try {
            const { year, semester, courseNo } = req.params;
            if (!year || !semester || !courseNo) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุข้อมูลวิชาที่ต้องการลบ' });
            }

            const cleanYear = year.toString().trim();
            const cleanSem = semester.toString().trim();
            const cleanCourse = courseNo.toString().trim().toUpperCase();
            const cleanUserHis = sanitizeUsername(req.body?.userInsert || req.body?.user || req.body?.email || req.query?.user || req.headers?.['x-user'], 'SYSTEM');

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 0. ตรวจสอบว่าวิชานี้ถูกนำไปจัดในตารางสอน RG_SCHEDULE_CLASS แล้วหรือไม่
                const checkScheduledSql = `
                    SELECT COUNT(*) AS CNT
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND UPPER(TRIM(COURSE_NO)) = :3
                `;
                const checkRes = await tx.fetchOne(checkScheduledSql, [cleanYear, cleanSem, cleanCourse]);
                const isScheduled = Number(checkRes?.CNT || 0) > 0;

                if (isScheduled) {
                    throw new Error(`ไม่สามารถลบวิชา ${cleanCourse} ได้ เนื่องจากถูกจัดลงในตารางสอนในปีการศึกษา ${cleanYear}/${cleanSem} แล้ว (กรุณาลบตารางสอนของวิชานี้ก่อน)`);
                }

                // 1. นำข้อมูลเดิมไปบันทึกลง HIS (เก็บ INSERT_DATE, USER_INSERT เดิมไว้ พร้อมบันทึก INSERT_HIS_DATE, USER_INSERT_HIS)
                const hisSql = `
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
                    WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3 AND UPPER(TRIM(COURSE_NO)) = :4
                `;
                await tx.executeOne(hisSql, [cleanUserHis, cleanYear, cleanSem, cleanCourse]);

                // 2. ลบออกจาก RG_SCHEDULE_COURSE
                const deleteSql = `
                    DELETE FROM RG_SCHEDULE_COURSE 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND UPPER(TRIM(COURSE_NO)) = :3
                `;
                await tx.executeOne(deleteSql, [cleanYear, cleanSem, cleanCourse]);
            });

            return res.status(200).json({
                success: true,
                message: `ลบวิชา ${cleanCourse} สำเร็จ (จัดเก็บประวัติลงใน HIS เรียบร้อย)`
            });
        } catch (error) {
            console.error('[CourseController.deleteCourse error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // 8. ลบวิชาที่เปิดสอนทีละหลายรายการ (BULK DELETE) -> ย้ายข้อมูลเข้า RG_SCHEDULE_COURSE_HIS ก่อนลบ
    async deleteCoursesBulk(req, res) {
        try {
            let { year, semester, courseNos, items } = req.body;
            if ((!year || !semester || !courseNos) && Array.isArray(items) && items.length > 0) {
                year = year || items[0].studyYear || items[0].year;
                semester = semester || items[0].studySemester || items[0].semester;
                courseNos = courseNos || items.map(it => it.courseNo || it.COURSE_NO);
            }

            if (!year || !semester || !Array.isArray(courseNos) || courseNos.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีการศึกษา ภาคการศึกษา และรายการวิชาที่ต้องการลบ' });
            }

            const cleanYear = year.toString().trim();
            const cleanSem = semester.toString().trim();
            const cleanList = Array.from(new Set(courseNos.map(c => c.toString().trim().toUpperCase()).filter(Boolean)));
            const cleanUserHis = sanitizeUsername(req.body?.userInsert || req.body?.userDelete || req.body?.user || req.body?.email || req.headers?.['x-user'], 'SYSTEM');

            let deletedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 0. ตรวจสอบว่ามีวิชาใดในรายการถูกจัดในตารางสอน RG_SCHEDULE_CLASS แล้วหรือไม่
                const checkInPlaceholders = cleanList.map((_, i) => `:${i + 3}`).join(', ');
                const checkBulkSql = `
                    SELECT DISTINCT UPPER(TRIM(COURSE_NO)) AS COURSE_NO
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :1 
                      AND TRIM(STUDY_SEMESTER) = :2
                      AND UPPER(TRIM(COURSE_NO)) IN (${checkInPlaceholders})
                `;
                const busyRows = await tx.fetchAll(checkBulkSql, [cleanYear, cleanSem, ...cleanList]);
                const busyCourses = busyRows.map(r => r.COURSE_NO);

                if (busyCourses.length > 0) {
                    throw new Error(`ไม่สามารถลบได้ เนื่องจากมีวิชา ${busyCourses.length} วิชาถูกจัดลงในตารางสอนแล้ว: ${busyCourses.join(', ')} (กรุณาลบตารางสอนของวิชาเหล่านี้ก่อน)`);
                }

                // 1. นำข้อมูลเดิมไปบันทึกลง HIS (bind :1=cleanUserHis, :2=cleanYear, :3=cleanSem, :4..=cleanList)
                const hisInPlaceholders = cleanList.map((_, i) => `:${i + 4}`).join(', ');
                const hisSql = `
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
                    WHERE TRIM(STUDY_YEAR) = :2 
                      AND TRIM(STUDY_SEMESTER) = :3 
                      AND UPPER(TRIM(COURSE_NO)) IN (${hisInPlaceholders})
                `;
                await tx.executeOne(hisSql, [cleanUserHis, cleanYear, cleanSem, ...cleanList]);

                // 2. ลบออกจาก RG_SCHEDULE_COURSE (bind :1=cleanYear, :2=cleanSem, :3..=cleanList)
                const delInPlaceholders = cleanList.map((_, i) => `:${i + 3}`).join(', ');
                const deleteSql = `
                    DELETE FROM RG_SCHEDULE_COURSE 
                    WHERE TRIM(STUDY_YEAR) = :1 
                      AND TRIM(STUDY_SEMESTER) = :2 
                      AND UPPER(TRIM(COURSE_NO)) IN (${delInPlaceholders})
                `;
                const delRes = await tx.executeOne(deleteSql, [cleanYear, cleanSem, ...cleanList]);
                deletedCount = delRes?.rowsAffected || cleanList.length;
            });

            return res.status(200).json({
                success: true,
                message: `ลบวิชา (${deletedCount} รายการ) สำเร็จ (จัดเก็บประวัติลงใน HIS เรียบร้อย)`,
                deletedCount
            });
        } catch (error) {
            console.error('[CourseController.deleteCoursesBulk error]', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = CourseController;
