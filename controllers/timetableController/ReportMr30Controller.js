const SelectModel = require('../../models/db/SelectModel');

const ReportMr30Controller = {
    async getReportMr30(req, res) {
        try {
            const { year, semester, facultyNo, dayCode, search } = req.query;

            let targetYear = year ? year.toString().trim() : '';
            let targetSem = semester ? semester.toString().trim() : '';

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
                return res.status(200).json({
                    success: true,
                    message: 'ไม่พบปีภาคการศึกษาปัจจุบัน',
                    year: '',
                    semester: '',
                    results: [],
                    summary: { totalCourses: 0, totalSlots: 0, totalInstructors: 0, totalFaculties: 0 }
                });
            }

            let sql = `
                SELECT 
                    TRIM(ru.STUDY_YEAR) AS STUDY_YEAR,
                    TRIM(ru.STUDY_SEMESTER) AS STUDY_SEMESTER,
                    TRIM(ru.COURSE_NO) AS COURSE_NO,
                    ru.SECTION_NO AS SECTION_NO,
                    ru.COURSE_METHOD AS COURSE_METHOD,
                    ru.COURSE_METHOD_NUMBER AS COURSE_METHOD_NUMBER,
                    ru.DAY_CODE AS DAY_CODE,
                    ru.TIME_CODE AS TIME_CODE,
                    TRIM(ru.BUILDING_CODE) AS BUILDING_CODE,
                    TRIM(ru.ROOM_CODE) AS ROOM_CODE,
                    ru.SEQUENCE_INSTRUCTOR AS SEQUENCE_INSTRUCTOR,
                    TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ui.INSTRUCTOR_NAME_ENG) AS INSTRUCTOR_NAME_ENG,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                    TRIM(ur.RANK_NAME_THAI_L) AS RANK_NAME_THAI_L,
                    TRIM(ui.FACULTY_NO) AS FACULTY_NO,
                    TRIM(uf.FACULTY_NAME_THAI) AS FACULTY_NAME_THAI,
                    TRIM(uf.FACULTY_NAME_SHORT) AS FACULTY_NAME_SHORT,
                    uc.COURSE_NAME_THAI AS COURSE_NAME_THAI,
                    uc.COURSE_NAME_ENG AS COURSE_NAME_ENG,
                    uc.CREDIT AS CREDIT,
                    TRIM(rst.TIME_START) AS TIME_START,
                    TRIM(rst.TIME_END) AS TIME_END
                FROM UGB_RU30 ru
                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                LEFT JOIN UGB_FACULTY uf ON TRIM(ui.FACULTY_NO) = TRIM(uf.FACULTY_NO)
                LEFT JOIN (
                    SELECT 
                        TRIM(COURSE_NO) AS COURSE_NO,
                        MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI,
                        MAX(TRIM(COURSE_NAME_ENG_L)) AS COURSE_NAME_ENG,
                        MAX(CREDIT) AS CREDIT
                    FROM UGB_COURSE
                    GROUP BY TRIM(COURSE_NO)
                ) uc ON TRIM(ru.COURSE_NO) = uc.COURSE_NO
                LEFT JOIN RG_SCHEDULE_TIME rst ON TRIM(ru.TIME_CODE) = TRIM(rst.TIME_CODE)
                WHERE TRIM(ru.STUDY_YEAR) = :1 AND TRIM(ru.STUDY_SEMESTER) = :2
            `;

            const params = [targetYear, targetSem];

            if (facultyNo && facultyNo.toString().trim() !== '' && facultyNo.toString().trim() !== 'ALL') {
                sql += ` AND TRIM(ui.FACULTY_NO) = :${params.length + 1}`;
                params.push(facultyNo.toString().trim());
            }

            if (dayCode && dayCode.toString().trim() !== '' && dayCode.toString().trim() !== 'ALL') {
                sql += ` AND ru.DAY_CODE = :${params.length + 1}`;
                params.push(Number(dayCode));
            }

            if (search && search.toString().trim() !== '') {
                const searchPattern = `%${search.toString().trim().toUpperCase()}%`;
                const pIndex = params.length + 1;
                sql += ` AND (
                    UPPER(TRIM(ru.COURSE_NO)) LIKE :${pIndex}
                    OR UPPER(TRIM(uc.COURSE_NAME_THAI)) LIKE :${pIndex}
                    OR UPPER(TRIM(uc.COURSE_NAME_ENG)) LIKE :${pIndex}
                    OR UPPER(TRIM(ru.INSTRUCTOR_CODE)) LIKE :${pIndex}
                    OR UPPER(TRIM(ui.INSTRUCTOR_NAME_THAI)) LIKE :${pIndex}
                    OR UPPER(TRIM(ui.INSTRUCTOR_NAME_ENG)) LIKE :${pIndex}
                    OR UPPER(TRIM(ru.ROOM_CODE)) LIKE :${pIndex}
                    OR UPPER(TRIM(ru.BUILDING_CODE)) LIKE :${pIndex}
                )`;
                params.push(searchPattern);
            }

            sql += ` ORDER BY ru.DAY_CODE ASC, ru.TIME_CODE ASC, ru.COURSE_NO ASC, ru.SECTION_NO ASC, ru.SEQUENCE_INSTRUCTOR ASC`;

            const result = await SelectModel.findAll(res, sql, params);
            const rows = (result && result.rows) ? result.rows : [];

            const slotMap = new Map();
            const distinctCourses = new Set();
            const distinctInstructors = new Set();
            const distinctFaculties = new Set();

            rows.forEach((r) => {
                const key = `${r.COURSE_NO}_${r.SECTION_NO || '1'}_${r.DAY_CODE}_${r.TIME_CODE}_${r.ROOM_CODE || r.BUILDING_CODE || ''}`;
                
                if (r.COURSE_NO) distinctCourses.add(r.COURSE_NO);
                if (r.INSTRUCTOR_CODE) distinctInstructors.add(r.INSTRUCTOR_CODE);
                if (r.FACULTY_NO) distinctFaculties.add(r.FACULTY_NO);

                const formatTime = (timeStr) => {
                    if (!timeStr) return '';
                    if (timeStr.length === 4) {
                        return `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;
                    }
                    return timeStr;
                };

                const startFormatted = formatTime(r.TIME_START);
                const endFormatted = formatTime(r.TIME_END);
                const period = (startFormatted && endFormatted) ? `${startFormatted} - ${endFormatted}` : (startFormatted || endFormatted || `คาบ ${r.TIME_CODE}`);

                if (!slotMap.has(key)) {
                    slotMap.set(key, {
                        key: key,
                        STUDY_YEAR: r.STUDY_YEAR,
                        STUDY_SEMESTER: r.STUDY_SEMESTER,
                        COURSE_NO: r.COURSE_NO,
                        COURSE_NAME_THAI: r.COURSE_NAME_THAI || '',
                        COURSE_NAME_ENG: r.COURSE_NAME_ENG || '',
                        CREDIT: r.CREDIT || null,
                        SECTION_NO: r.SECTION_NO || 1,
                        COURSE_METHOD: r.COURSE_METHOD,
                        COURSE_METHOD_NUMBER: r.COURSE_METHOD_NUMBER,
                        DAY_CODE: r.DAY_CODE,
                        TIME_CODE: r.TIME_CODE,
                        TIME_START: r.TIME_START,
                        TIME_END: r.TIME_END,
                        PERIOD: period,
                        BUILDING_CODE: r.BUILDING_CODE || '',
                        ROOM_CODE: r.ROOM_CODE || '',
                        FACULTY_NO: r.FACULTY_NO || '',
                        FACULTY_NAME_THAI: r.FACULTY_NAME_THAI || '',
                        FACULTY_NAME_SHORT: r.FACULTY_NAME_SHORT || '',
                        INSTRUCTORS: [],
                    });
                }

                if (r.INSTRUCTOR_CODE) {
                    const slot = slotMap.get(key);
                    const exists = slot.INSTRUCTORS.some((i) => i.INSTRUCTOR_CODE === r.INSTRUCTOR_CODE);
                    if (!exists) {
                        slot.INSTRUCTORS.push({
                            INSTRUCTOR_CODE: r.INSTRUCTOR_CODE,
                            INSTRUCTOR_NAME_THAI: r.INSTRUCTOR_NAME_THAI || '',
                            INSTRUCTOR_NAME_ENG: r.INSTRUCTOR_NAME_ENG || '',
                            RANK_NAME_THAI_S: r.RANK_NAME_THAI_S || '',
                            RANK_NAME_THAI_L: r.RANK_NAME_THAI_L || '',
                            SEQUENCE_INSTRUCTOR: r.SEQUENCE_INSTRUCTOR,
                        });
                    }
                }
            });

            const groupedResults = Array.from(slotMap.values());

            return res.status(200).json({
                success: true,
                year: targetYear,
                semester: targetSem,
                results: groupedResults,
                rawTotal: rows.length,
                summary: {
                    totalCourses: distinctCourses.size,
                    totalSlots: groupedResults.length,
                    totalInstructors: distinctInstructors.size,
                    totalFaculties: distinctFaculties.size,
                },
            });
        } catch (error) {
            console.error('[ReportMr30Controller.getReportMr30 error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

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
            console.error('[ReportMr30Controller.getFaculties error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    }
};

module.exports = ReportMr30Controller;
