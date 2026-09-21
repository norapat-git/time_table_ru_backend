const SelectModel = require('../../models/db/SelectModel');

/**
 * TimetableListController
 * รับผิดชอบ: ดึงรายการตารางสอน และค้นหาวิชาแบบ A-Z
 *  - listScheduleClasses  → GET /timetable/list
 *  - getRu30Options       → GET /timetable/ru30-options
 *  - getFirstLetters      → GET /timetable/letters
 *  - getPrefixGroups      → GET /timetable/prefixes/:letter
 *  - getCoursesByPrefix   → GET /timetable/search-ugb
 */
const TimetableListController = {
    async listScheduleClasses(req, res) {
        try {
            const { year, semester, dayCode, roomCode, search } = req.query;

            let targetYear = year;
            let targetSem = semester;

            if (!targetYear || !targetSem) {
                const activeSql = `
                    SELECT TRIM(STUDY_YEAR) AS STUDY_YEAR, TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER 
                    FROM RG_SCHEDULE_YEARSEM 
                    WHERE STUDY_ACTIVE = '1'
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

            let classSql = `
                SELECT 
                    TRIM(rc.STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(rc.STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(rc.COURSE_NO) AS COURSE_NO,
                    rc.DAY_CODE AS DAY_CODE,
                    rc.TIME_CODE AS TIME_CODE,
                    TRIM(rc.ROOM_CODE) AS ROOM_CODE,
                    TRIM(rd.ROOM_DETAIL) AS ROOM_DETAIL,
                    rc.INSTR_GROUP AS INSTR_GROUP,
                    TO_CHAR(rc.INSERT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS INSERT_DATE,
                    TRIM(rc.USER_INSERT) AS USER_INSERT,
                    uc.COURSE_NAME_THAI AS COURSE_NAME_THAI,
                    uc.COURSE_NAME_ENG AS COURSE_NAME_ENG,
                    uc.CREDIT AS CREDIT
                FROM RG_SCHEDULE_CLASS rc
                LEFT JOIN RG_SCHEDULE_ROOM_DETAIL rd ON TRIM(rc.ROOM_CODE) = TRIM(rd.ROOM_CODE)
                LEFT JOIN (
                    SELECT 
                        TRIM(COURSE_NO) AS COURSE_NO,
                        MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                        MAX(TRIM(COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG,
                        MAX(CREDIT) AS CREDIT
                    FROM UGB_COURSE
                    GROUP BY TRIM(COURSE_NO)
                ) uc ON TRIM(rc.COURSE_NO) = uc.COURSE_NO
                WHERE TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2
            `;
            const classParams = [targetYear, targetSem];

            if (dayCode && dayCode.toString().trim() !== '') {
                classSql += ` AND rc.DAY_CODE = :${classParams.length + 1}`;
                classParams.push(Number(dayCode));
            }

            if (roomCode && roomCode.toString().trim() !== '') {
                classSql += ` AND UPPER(TRIM(rc.ROOM_CODE)) = :${classParams.length + 1}`;
                classParams.push(roomCode.toString().trim().toUpperCase());
            }

            if (search && search.toString().trim() !== '') {
                const searchPattern = `%${search.toString().trim().toUpperCase()}%`;
                const pIndex = classParams.length + 1;
                classSql += ` AND (
                    UPPER(TRIM(rc.COURSE_NO)) LIKE :${pIndex}
                    OR UPPER(TRIM(uc.COURSE_NAME_THAI)) LIKE :${pIndex}
                    OR UPPER(TRIM(uc.COURSE_NAME_ENG)) LIKE :${pIndex}
                    OR UPPER(TRIM(rc.ROOM_CODE)) LIKE :${pIndex}
                    OR UPPER(TRIM(rd.ROOM_DETAIL)) LIKE :${pIndex}
                )`;
                classParams.push(searchPattern);
            }

            classSql += ` ORDER BY rc.DAY_CODE ASC, rc.TIME_CODE ASC, rc.COURSE_NO ASC`;

            const classRes = await SelectModel.findAll(res, classSql, classParams);
            const classes = classRes.rows ?? [];

            if (classes.length === 0) {
                return res.status(200).json({
                    success: true,
                    currentYear: targetYear,
                    currentSemester: targetSem,
                    results: [],
                });
            }

            const teachSql = `
                SELECT 
                    TRIM(rt.STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(rt.STUDY_SEMESTER) AS STUDY_SEMESTER,
                    rt.INSTRUCTOR_GROUP AS INSTRUCTOR_GROUP,
                    TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    rt.INSTRUCTOR_ORD AS INSTRUCTOR_ORD,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ui.INSTRUCTOR_NAME_ENG) AS INSTRUCTOR_NAME_ENG,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                    TRIM(ur.RANK_NAME_THAI_L) AS RANK_NAME_THAI_L
                FROM RG_SCHEDULE_TEACH rt
                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                WHERE TRIM(rt.STUDY_YEAR) = :1 AND TRIM(rt.STUDY_SEMESTER) = :2
                ORDER BY rt.INSTRUCTOR_GROUP ASC, TO_NUMBER(rt.INSTRUCTOR_ORD) ASC
            `;
            const teachRes = await SelectModel.findAll(res, teachSql, [targetYear, targetSem]);
            const teachRows = teachRes.rows ?? [];

            const teachersByGroup = {};
            teachRows.forEach((t) => {
                const grp = t.INSTRUCTOR_GROUP?.toString() || '';
                if (!teachersByGroup[grp]) {
                    teachersByGroup[grp] = [];
                }
                if (!teachersByGroup[grp].some(i => i.INSTRUCTOR_CODE === t.INSTRUCTOR_CODE)) {
                    teachersByGroup[grp].push({
                        INSTRUCTOR_CODE: t.INSTRUCTOR_CODE,
                        INSTRUCTOR_NAME_THAI: t.INSTRUCTOR_NAME_THAI,
                        INSTRUCTOR_NAME_ENG: t.INSTRUCTOR_NAME_ENG,
                        RANK_NAME_THAI_S: t.RANK_NAME_THAI_S,
                        RANK_NAME_THAI_L: t.RANK_NAME_THAI_L,
                        INSTRUCTOR_ORD: t.INSTRUCTOR_ORD,
                    });
                }
            });

            let pairRows = [];
            try {
                const pairSql = `
                    SELECT 
                        p.PAIR_COURSE_GROUP_ID,
                        TRIM(p.COURSE_NO) AS COURSE_NO,
                        TRIM(p.START_YEAR) AS START_YEAR,
                        TRIM(p.STOP_YEAR) AS STOP_YEAR,
                        TRIM(p.YEAR_LEVEL) AS YEAR_LEVEL,
                        TRIM(p.SEMESTER) AS SEMESTER,
                        uc.COURSE_NAME_THAI,
                        uc.COURSE_NAME_ENG,
                        uc.CREDIT
                    FROM RG_SCHEDULE_PAIR_COURSE p
                    LEFT JOIN (
                        SELECT 
                            TRIM(COURSE_NO) AS COURSE_NO,
                            MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                            MAX(TRIM(COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG,
                            MAX(CREDIT) AS CREDIT
                        FROM UGB_COURSE
                        GROUP BY TRIM(COURSE_NO)
                    ) uc ON TRIM(p.COURSE_NO) = uc.COURSE_NO
                    ORDER BY p.PAIR_COURSE_GROUP_ID ASC, TRIM(p.COURSE_NO) ASC
                `;
                const pairRes = await SelectModel.findAll(res, pairSql, []);
                pairRows = pairRes?.rows || [];
            } catch (pErr) {
                console.error('[listScheduleClasses pairSql error]', pErr);
            }

            const pairGroupByGroupId = {};
            pairRows.forEach((pr) => {
                const gId = pr.PAIR_COURSE_GROUP_ID;
                if (!pairGroupByGroupId[gId]) pairGroupByGroupId[gId] = [];
                pairGroupByGroupId[gId].push(pr);
            });

            const pairedCoursesByCourseNo = {};
            Object.keys(pairGroupByGroupId).forEach((gId) => {
                const groupCourses = pairGroupByGroupId[gId];
                groupCourses.forEach((c) => {
                    const cNo = (c.COURSE_NO || '').trim().toUpperCase();
                    const otherCourses = groupCourses
                        .filter((oc) => (oc.COURSE_NO || '').trim().toUpperCase() !== cNo)
                        .map((oc) => ({
                            groupId: oc.PAIR_COURSE_GROUP_ID,
                            courseNo: oc.COURSE_NO,
                            courseNameThai: oc.COURSE_NAME_THAI || '',
                            courseNameEng: oc.COURSE_NAME_ENG || '',
                            credit: oc.CREDIT,
                            startYear: oc.START_YEAR,
                            stopYear: oc.STOP_YEAR,
                            yearLevel: oc.YEAR_LEVEL,
                            semester: oc.SEMESTER
                        }));
                    if (!pairedCoursesByCourseNo[cNo]) {
                        pairedCoursesByCourseNo[cNo] = [];
                    }
                    otherCourses.forEach(oc => {
                        if (!pairedCoursesByCourseNo[cNo].some(x => x.courseNo === oc.courseNo)) {
                            pairedCoursesByCourseNo[cNo].push(oc);
                        }
                    });
                });
            });

            const results = classes.map((c) => {
                const cNo = (c.COURSE_NO || '').trim().toUpperCase();
                const pairedList = pairedCoursesByCourseNo[cNo] || [];
                return {
                    ...c,
                    INSTRUCTORS: teachersByGroup[c.INSTR_GROUP?.toString()] || [],
                    PAIRED_COURSES: pairedList,
                    HAS_PAIRED_COURSES: pairedList.length > 0,
                };
            });

            return res.status(200).json({
                success: true,
                currentYear: targetYear,
                currentSemester: targetSem,
                results: results,
            });
        } catch (error) {
            console.error('[TimetableListController.listScheduleClasses error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

    async getRu30Options(req, res) {
        try {
            const { year, semester, courseNo } = req.query;

            if (!courseNo) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสวิชา' });
            }

            let targetYear = year;
            let targetSem = semester;

            if (!targetYear || !targetSem) {
                const activeSql = `
                    SELECT TRIM(STUDY_YEAR) AS STUDY_YEAR, TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER 
                    FROM RG_SCHEDULE_YEARSEM 
                    WHERE STUDY_ACTIVE = '1'
                `;
                const activeRes = await SelectModel.findAll(res, activeSql, []);
                if (activeRes.rows && activeRes.rows.length > 0) {
                    targetYear = activeRes.rows[0].STUDY_YEAR;
                    targetSem = activeRes.rows[0].STUDY_SEMESTER;
                }
            }

            const sql = `
                SELECT 
                    TRIM(ru.STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(ru.STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(ru.COURSE_NO) AS COURSE_NO,
                    ru.DAY_CODE AS DAY_CODE,
                    ru.TIME_CODE AS TIME_CODE,
                    TRIM(ru.BUILDING_CODE) AS BUILDING_CODE,
                    TRIM(ru.ROOM_CODE) AS ROOM_CODE,
                    TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    ru.SEQUENCE_INSTRUCTOR AS SEQUENCE_INSTRUCTOR,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ui.INSTRUCTOR_NAME_ENG) AS INSTRUCTOR_NAME_ENG,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                    TRIM(ur.RANK_NAME_THAI_L) AS RANK_NAME_THAI_L
                FROM UGB_RU30 ru
                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                WHERE REPLACE(UPPER(TRIM(ru.COURSE_NO)), ' ', '') = REPLACE(UPPER(TRIM(:1)), ' ', '')
                ORDER BY ru.DAY_CODE ASC, ru.TIME_CODE ASC, ru.SEQUENCE_INSTRUCTOR ASC
            `;
            const cleanCourse = courseNo.toString().trim().toUpperCase();
            const result = await SelectModel.findAll(res, sql, [cleanCourse]);
            const rows = result.rows ?? [];

            const slotMap = new Map();
            rows.forEach((r) => {
                const key = `${r.DAY_CODE}_${r.TIME_CODE}_${r.ROOM_CODE || r.BUILDING_CODE || ''}`;
                if (!slotMap.has(key)) {
                    slotMap.set(key, {
                        DAY_CODE: r.DAY_CODE,
                        TIME_CODE: r.TIME_CODE,
                        BUILDING_CODE: r.BUILDING_CODE,
                        ROOM_CODE: r.ROOM_CODE,
                        INSTRUCTORS: [],
                    });
                }
                if (r.INSTRUCTOR_CODE) {
                    const currentSlot = slotMap.get(key);
                    const alreadyExists = currentSlot.INSTRUCTORS.some((i) => i.INSTRUCTOR_CODE === r.INSTRUCTOR_CODE);
                    if (!alreadyExists) {
                        currentSlot.INSTRUCTORS.push({
                            INSTRUCTOR_CODE: r.INSTRUCTOR_CODE,
                            INSTRUCTOR_NAME_THAI: r.INSTRUCTOR_NAME_THAI,
                            INSTRUCTOR_NAME_ENG: r.INSTRUCTOR_NAME_ENG,
                            RANK_NAME_THAI_S: r.RANK_NAME_THAI_S,
                            SEQUENCE_INSTRUCTOR: r.SEQUENCE_INSTRUCTOR,
                        });
                    }
                }
            });

            return res.status(200).json({
                success: true,
                courseNo: courseNo.trim().toUpperCase(),
                slots: Array.from(slotMap.values()),
                rawRows: rows,
            });
        } catch (error) {
            console.error('[TimetableListController.getRu30Options error]', error);
            return res.status(500).json({ success: false, message: error.message, slots: [] });
        }
    },

    async getFirstLetters(req, res) {
        try {
            const { year, semester } = req.query;
            let targetYear = year ? year.toString().trim() : '';
            let targetSem = semester ? semester.toString().trim() : '';

            if (!targetYear || !targetSem) {
                const activeSql = `SELECT TRIM(STUDY_YEAR) AS STUDY_YEAR, TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER FROM RG_SCHEDULE_YEARSEM WHERE STUDY_ACTIVE = '1'`;
                const activeRes = await SelectModel.findAll(res, activeSql, []);
                if (activeRes.rows && activeRes.rows.length > 0) {
                    targetYear = activeRes.rows[0].STUDY_YEAR;
                    targetSem = activeRes.rows[0].STUDY_SEMESTER;
                }
            }

            const sql = `
                SELECT DISTINCT UPPER(SUBSTR(TRIM(rc.COURSE_NO), 1, 1)) AS LETTER 
                FROM RG_SCHEDULE_COURSE rc
                WHERE TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2
                  AND REGEXP_LIKE(SUBSTR(TRIM(rc.COURSE_NO), 1, 1), '^[A-Za-z]')
                ORDER BY LETTER ASC
            `;
            const result = await SelectModel.findAll(res, sql, [targetYear, targetSem]);
            const letters = (result.rows ?? []).map(r => r.LETTER).filter(Boolean);
            return res.status(200).json({ success: true, results: letters });
        } catch (error) {
            console.error('[TimetableListController.getFirstLetters error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

    async getPrefixGroups(req, res) {
        try {
            const letter = req.params.letter?.trim().toUpperCase();
            const { year, semester } = req.query;

            if (!letter) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุตัวอักษรนำหน้า' });
            }

            let targetYear = year ? year.toString().trim() : '';
            let targetSem = semester ? semester.toString().trim() : '';

            if (!targetYear || !targetSem) {
                const activeSql = `SELECT TRIM(STUDY_YEAR) AS STUDY_YEAR, TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER FROM RG_SCHEDULE_YEARSEM WHERE STUDY_ACTIVE = '1'`;
                const activeRes = await SelectModel.findAll(res, activeSql, []);
                if (activeRes.rows && activeRes.rows.length > 0) {
                    targetYear = activeRes.rows[0].STUDY_YEAR;
                    targetSem = activeRes.rows[0].STUDY_SEMESTER;
                }
            }

            const sql = `
                SELECT DISTINCT UPPER(REGEXP_SUBSTR(TRIM(rc.COURSE_NO), '^[A-Za-z]+')) AS PREFIX_NAME,
                                COUNT(DISTINCT TRIM(rc.COURSE_NO)) AS COURSE_COUNT
                FROM RG_SCHEDULE_COURSE rc
                WHERE TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2
                  AND UPPER(SUBSTR(TRIM(rc.COURSE_NO), 1, 1)) = :3
                GROUP BY UPPER(REGEXP_SUBSTR(TRIM(rc.COURSE_NO), '^[A-Za-z]+'))
                ORDER BY PREFIX_NAME ASC
            `;
            const result = await SelectModel.findAll(res, sql, [targetYear, targetSem, letter]);
            return res.status(200).json({ success: true, letter, results: result.rows ?? [] });
        } catch (error) {
            console.error('[TimetableListController.getPrefixGroups error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async getCoursesByPrefix(req, res) {
        try {
            const { prefix, search, year, semester } = req.query;

            let targetYear = year ? year.toString().trim() : '';
            let targetSem = semester ? semester.toString().trim() : '';

            if (!targetYear || !targetSem) {
                const activeSql = `SELECT TRIM(STUDY_YEAR) AS STUDY_YEAR, TRIM(STUDY_SEMESTER) AS STUDY_SEMESTER FROM RG_SCHEDULE_YEARSEM WHERE STUDY_ACTIVE = '1'`;
                const activeRes = await SelectModel.findAll(res, activeSql, []);
                if (activeRes.rows && activeRes.rows.length > 0) {
                    targetYear = activeRes.rows[0].STUDY_YEAR;
                    targetSem = activeRes.rows[0].STUDY_SEMESTER;
                }
            }

            let whereClause = `TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2`;
            const params = [targetYear, targetSem];

            if (prefix && prefix.toString().trim() !== '') {
                const cleanPrefix = prefix.toString().trim().toUpperCase();
                whereClause += ` AND UPPER(TRIM(rc.COURSE_NO)) LIKE :${params.length + 1}`;
                params.push(`${cleanPrefix}%`);
            }

            if (search && search.toString().trim() !== '') {
                const searchPattern = `%${search.toString().trim().toUpperCase()}%`;
                const pIndex = params.length + 1;
                whereClause += ` AND (
                    UPPER(TRIM(rc.COURSE_NO)) LIKE :${pIndex}
                    OR UPPER(TRIM(uc.COURSE_NAME_THAI)) LIKE :${pIndex}
                    OR UPPER(TRIM(uc.COURSE_NAME_ENG_L)) LIKE :${pIndex}
                )`;
                params.push(searchPattern);
            }

            const sql = `
                SELECT 
                    TRIM(rc.COURSE_NO) AS COURSE_NO,
                    MAX(TRIM(uc.COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                    MAX(TRIM(uc.COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG,
                    MAX(uc.CREDIT) AS CREDIT
                FROM RG_SCHEDULE_COURSE rc
                LEFT JOIN UGB_COURSE uc ON TRIM(rc.COURSE_NO) = TRIM(uc.COURSE_NO)
                WHERE ${whereClause}
                GROUP BY TRIM(rc.COURSE_NO)
                ORDER BY TRIM(rc.COURSE_NO) ASC
            `;

            const result = await SelectModel.findAll(res, sql, params);
            return res.status(200).json({ success: true, results: result?.rows ?? [] });
        } catch (error) {
            console.error('[TimetableListController.getCoursesByPrefix error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },
};

module.exports = TimetableListController;
