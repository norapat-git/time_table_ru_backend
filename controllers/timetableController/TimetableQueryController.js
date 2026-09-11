const SelectModel = require('../../models/db/SelectModel');

/**
 * ฟังก์ชันตรวจสอบช่วงเวลาคาบเกี่ยว/เหลื่อมล้ำกัน (Time Overlap)
 */
function isTimeOverlapping(startA, endA, startB, endB) {
    if (!startA || !endA || !startB || !endB) return false;
    const sA = parseInt(startA.toString().replace(':', ''), 10);
    const eA = parseInt(endA.toString().replace(':', ''), 10);
    const sB = parseInt(startB.toString().replace(':', ''), 10);
    const eB = parseInt(endB.toString().replace(':', ''), 10);
    return sA < eB && eA > sB;
}

/**
 * ฟังก์ชันแปลงเวลา 4 หลัก (0800) ให้มีโคลอน (08:00)
 */
function formatMilitaryTime(tm) {
    if (!tm) return '';
    const str = tm.toString().trim();
    return str.length === 4 ? `${str.slice(0, 2)}:${str.slice(2)}` : str;
}

/**
 * TimetableQueryController
 * รับผิดชอบ: ดึงข้อมูลตัวเลือก (อาจารย์, วัน, คาบ, ห้อง) และตรวจสอบความพร้อม
 *  - getAllInstructors              → GET /timetable/instructors
 *  - getInstructorAvailability     → GET /timetable/instructor-availability
 *  - getSlotAvailableInstructors   → GET /timetable/slot-available-instructors
 *  - getDayOptions                 → GET /timetable/days
 *  - getTimeSlots                  → GET /timetable/times
 *  - getRoomOptions                → GET /timetable/rooms
 *  - getScheduledRooms             → GET /timetable/scheduled-rooms
 *  - checkInstructorConflicts      → GET /timetable/check-instructor-conflicts
 *  - recommendSlots                → GET /timetable/recommend-slots
 */
const TimetableQueryController = {
    // 4. ดึงรายชื่ออาจารย์ที่เปิดสอนในปีภาคนี้จาก RG_SCHEDULE_INSTRUCTOR + UGB_INSTRUCTOR + UGB_RANK
    async getAllInstructors(req, res) {
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
                SELECT 
                    TRIM(ri.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ui.INSTRUCTOR_NAME_ENG) AS INSTRUCTOR_NAME_ENG,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                    TRIM(ur.RANK_NAME_THAI_L) AS RANK_NAME_THAI_L,
                    TRIM(uf.FACULTY_NAME_SHORT) AS FACULTY_NAME_SHORT,
                    TRIM(uf.FACULTY_NAME_THAI) AS FACULTY_NAME_THAI
                FROM RG_SCHEDULE_INSTRUCTOR ri
                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ri.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                LEFT JOIN UGB_FACULTY uf ON TRIM(ui.FACULTY_NO) = TRIM(uf.FACULTY_NO)
                WHERE TRIM(ri.STUDY_YEAR) = :1 AND TRIM(ri.STUDY_SEMESTER) = :2
                ORDER BY ui.FACULTY_NO ASC, ui.INSTRUCTOR_NAME_THAI ASC
            `;
            const result = await SelectModel.findAll(res, sql, [targetYear, targetSem]);
            return res.status(200).json({ success: true, results: result.rows ?? [] });
        } catch (error) {
            console.error('[TimetableQueryController.getAllInstructors error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

    // 3.9 ตรวจสอบวันและเวลาที่ว่างตรงกันของอาจารย์ที่เลือก (Instructor Availability Matrix)
    async getInstructorAvailability(req, res) {
        try {
            const { year, semester, instructorCodes, courseNo } = req.query;
            const currentCourseNo = (courseNo || '').toString().trim().toUpperCase();

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

            const rawCodes = typeof instructorCodes === 'string'
                ? instructorCodes.split(',').map(c => c.trim()).filter(Boolean)
                : (Array.isArray(instructorCodes) ? instructorCodes.map(c => (c || '').toString().trim()).filter(Boolean) : []);

            const uniqueCodes = Array.from(new Set(rawCodes));

            if (uniqueCodes.length === 0) {
                return res.status(200).json({ success: true, totalInstructors: 0, slots: [], commonFreeSlots: [] });
            }

            // 1. ดึงวันเรียนทั้งหมดจาก UGB_DAY_SCHEDULE (วันจันทร์ - อาทิตย์ รหัส 1-7 เท่านั้น ไม่เอา 0 หรือวันควบ)
            let days = [];
            try {
                const daySql = `
                    SELECT 
                        DAY_CODE,
                        TRIM(DAY_NAME_S) AS DAY_NAME_S,
                        TRIM(DAY_NAME_L) AS DAY_NAME_L,
                        TRIM(DAY_NAME_STANDARD) AS DAY_NAME_STANDARD
                    FROM UGB_DAY_SCHEDULE
                    WHERE DAY_CODE BETWEEN 1 AND 7
                    ORDER BY DAY_CODE ASC
                `;
                const dayRes = await SelectModel.findAll(res, daySql, []);
                const dayNamesMap = {
                    1: { label: 'วันจันทร์', short: 'จันทร์', colorClass: 'day-mon' },
                    2: { label: 'วันอังคาร', short: 'อังคาร', colorClass: 'day-tue' },
                    3: { label: 'วันพุธ', short: 'พุธ', colorClass: 'day-wed' },
                    4: { label: 'วันพฤหัสบดี', short: 'พฤหัสบดี', colorClass: 'day-thu' },
                    5: { label: 'วันศุกร์', short: 'ศุกร์', colorClass: 'day-fri' },
                    6: { label: 'วันเสาร์', short: 'เสาร์', colorClass: 'day-sat' },
                    7: { label: 'วันอาทิตย์', short: 'อาทิตย์', colorClass: 'day-sun' },
                };

                if (dayRes && dayRes.rows && dayRes.rows.length > 0) {
                    days = dayRes.rows.map((r) => {
                        const code = Number(r.DAY_CODE);
                        const info = dayNamesMap[code] || {
                            label: r.DAY_NAME_L || `วันรหัส ${code}`,
                            short: r.DAY_NAME_S || `${code}`,
                            colorClass: 'day-mon',
                        };
                        return {
                            dayCode: code,
                            dayLabel: info.label,
                            dayShort: info.short,
                            colorClass: info.colorClass
                        };
                    });
                }
            } catch (dayErr) {
                console.error('[getInstructorAvailability daySql error]', dayErr);
            }

            if (days.length === 0) {
                days = [
                    { dayCode: 1, dayLabel: 'วันจันทร์', dayShort: 'จันทร์', colorClass: 'day-mon' },
                    { dayCode: 2, dayLabel: 'วันอังคาร', dayShort: 'อังคาร', colorClass: 'day-tue' },
                    { dayCode: 3, dayLabel: 'วันพุธ', dayShort: 'พุธ', colorClass: 'day-wed' },
                    { dayCode: 4, dayLabel: 'วันพฤหัสบดี', dayShort: 'พฤหัสบดี', colorClass: 'day-thu' },
                    { dayCode: 5, dayLabel: 'วันศุกร์', dayShort: 'ศุกร์', colorClass: 'day-fri' },
                    { dayCode: 6, dayLabel: 'วันเสาร์', dayShort: 'เสาร์', colorClass: 'day-sat' },
                    { dayCode: 7, dayLabel: 'วันอาทิตย์', dayShort: 'อาทิตย์', colorClass: 'day-sun' },
                ];
            }

            // 2. ดึงเวลาเรียนของตารางสอนจาก RG_SCHEDULE_TIME (ภาค 1-2 ใช้ TIME_FLAG='1', ภาค 3/Summer ใช้ TIME_FLAG='2')
            const isSummer = targetSem === '3' || targetSem.toUpperCase() === 'S';
            const timeFlag = isSummer ? '2' : '1';

            let times = [];
            try {
                const timeSql = `
                    SELECT 
                        TRIM(TIME_CODE) AS TIME_CODE,
                        TRIM(TIME_START) AS TIME_START,
                        TRIM(TIME_END) AS TIME_END,
                        TRIM(TIME_FLAG) AS TIME_FLAG
                    FROM RG_SCHEDULE_TIME
                    WHERE TRIM(TIME_FLAG) = :1
                    ORDER BY TO_NUMBER(TIME_CODE) ASC
                `;
                const timeRes = await SelectModel.findAll(res, timeSql, [timeFlag]);
                let dbRows = timeRes?.rows || [];

                if (dbRows.length === 0) {
                    if (timeFlag === '2') {
                        dbRows = [
                            { TIME_CODE: '1', TIME_START: '0835', TIME_END: '0950', TIME_FLAG: '2' },
                            { TIME_CODE: '2', TIME_START: '0955', TIME_END: '1110', TIME_FLAG: '2' },
                            { TIME_CODE: '3', TIME_START: '1115', TIME_END: '1230', TIME_FLAG: '2' },
                            { TIME_CODE: '4', TIME_START: '1235', TIME_END: '1350', TIME_FLAG: '2' },
                            { TIME_CODE: '5', TIME_START: '1355', TIME_END: '1510', TIME_FLAG: '2' },
                        ];
                    } else {
                        dbRows = [
                            { TIME_CODE: '1', TIME_START: '0800', TIME_END: '0915', TIME_FLAG: '1' },
                            { TIME_CODE: '2', TIME_START: '0925', TIME_END: '1040', TIME_FLAG: '1' },
                            { TIME_CODE: '3', TIME_START: '1050', TIME_END: '1205', TIME_FLAG: '1' },
                            { TIME_CODE: '4', TIME_START: '1215', TIME_END: '1330', TIME_FLAG: '1' },
                            { TIME_CODE: '5', TIME_START: '1340', TIME_END: '1455', TIME_FLAG: '1' },
                            { TIME_CODE: '6', TIME_START: '1505', TIME_END: '1620', TIME_FLAG: '1' },
                        ];
                    }
                }

                times = dbRows.map((r) => {
                    const code = Number(r.TIME_CODE);
                    const start = formatMilitaryTime(r.TIME_START);
                    const end = formatMilitaryTime(r.TIME_END);
                    const period = `${start} - ${end}`;
                    return {
                        timeCode: code,
                        timeStart: r.TIME_START,
                        timeEnd: r.TIME_END,
                        period: period,
                        label: `คาบที่ ${code} (${period})`
                    };
                });
            } catch (timeErr) {
                console.error('[getInstructorAvailability timeSql error]', timeErr);
            }

            // 3. ดึงคาบสอนที่อาจารย์มีสอนอยู่แล้วในระบบส่วนกลาง มร.30 (UGB_RU30 JOIN UGB_TIME_SCHEDULE)
            let ru30Rows = [];
            try {
                const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 3}`).join(', ');
                const busyParams = [targetYear, targetSem, ...uniqueCodes];
                const ru30Sql = `
                    SELECT DISTINCT 
                        TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                        TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                        TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                        ru.DAY_CODE AS DAY_CODE,
                        ru.TIME_CODE AS RU30_TIME_CODE,
                        TRIM(ts.TIME_START) AS RU30_START,
                        TRIM(ts.TIME_END) AS RU30_END,
                        TRIM(ru.COURSE_NO) AS RU30_COURSE_NO,
                        TRIM(uc.COURSE_NAME_THAI) AS RU30_COURSE_NAME
                    FROM UGB_RU30 ru
                    LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                    LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                    LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                    LEFT JOIN (
                        SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI 
                        FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                    ) uc ON TRIM(ru.COURSE_NO) = uc.COURSE_NO
                    WHERE TRIM(ru.STUDY_YEAR) = :1 
                      AND TRIM(ru.STUDY_SEMESTER) = :2
                      AND TRIM(ru.INSTRUCTOR_CODE) IN (${inPlaceholders})
                      AND ru.DAY_CODE IS NOT NULL 
                      AND ru.DAY_CODE BETWEEN 1 AND 7
                `;
                const ru30Res = await SelectModel.findAll(res, ru30Sql, busyParams);
                if (ru30Res && ru30Res.rows && ru30Res.rows.length > 0) {
                    ru30Rows = ru30Res.rows;
                } else {
                    // Fallback to all semesters in RU30 if specific year/sem has no records
                    const fallbackInPlaceholders = uniqueCodes.map((_, i) => `:${i + 1}`).join(', ');
                    const fallbackRu30Sql = `
                        SELECT DISTINCT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                            TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                            ru.DAY_CODE AS DAY_CODE,
                            ru.TIME_CODE AS RU30_TIME_CODE,
                            TRIM(ts.TIME_START) AS RU30_START,
                            TRIM(ts.TIME_END) AS RU30_END,
                            TRIM(ru.COURSE_NO) AS RU30_COURSE_NO,
                            TRIM(uc.COURSE_NAME_THAI) AS RU30_COURSE_NAME
                        FROM UGB_RU30 ru
                        LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                        LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                        LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                        LEFT JOIN (
                            SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI 
                            FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                        ) uc ON TRIM(ru.COURSE_NO) = uc.COURSE_NO
                        WHERE TRIM(ru.INSTRUCTOR_CODE) IN (${fallbackInPlaceholders})
                          AND ru.DAY_CODE IS NOT NULL 
                          AND ru.DAY_CODE BETWEEN 1 AND 7
                    `;
                    const fallbackRes = await SelectModel.findAll(res, fallbackRu30Sql, uniqueCodes);
                    if (fallbackRes && fallbackRes.rows) {
                        ru30Rows = fallbackRes.rows;
                    }
                }
            } catch (ru30Err) {
                console.error('[getInstructorAvailability ru30Sql error]', ru30Err);
            }

            // 4. ดึงคาบสอนที่อาจารย์เหล่านี้ถูกจัดตารางสอนวิชาอื่นไปแล้วในระบบคณะ (จาก RG_SCHEDULE_CLASS + RG_SCHEDULE_TEACH)
            let busyRows = [];
            try {
                const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 3}`).join(', ');
                const busyParams = [targetYear, targetSem, ...uniqueCodes];
                const busySql = `
                    SELECT 
                        rc.DAY_CODE AS DAY_CODE,
                        rc.TIME_CODE AS TIME_CODE,
                        TRIM(rc.COURSE_NO) AS COURSE_NO,
                        TRIM(uc.COURSE_NAME_THAI) AS COURSE_NAME_THAI,
                        TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                        TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                        TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S
                    FROM RG_SCHEDULE_CLASS rc
                    JOIN RG_SCHEDULE_TEACH rt 
                        ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR) 
                       AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER) 
                       AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(rt.INSTRUCTOR_GROUP)
                    LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                    LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                    LEFT JOIN (
                        SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI 
                        FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                    ) uc ON TRIM(rc.COURSE_NO) = uc.COURSE_NO
                    WHERE TRIM(rc.STUDY_YEAR) = :1 
                      AND TRIM(rc.STUDY_SEMESTER) = :2
                      AND TRIM(rt.INSTRUCTOR_CODE) IN (${inPlaceholders})
                `;
                const busyRes = await SelectModel.findAll(res, busySql, busyParams);
                if (busyRes && busyRes.rows) {
                    busyRows = busyRes.rows;
                }
            } catch (busyErr) {
                console.error('[getInstructorAvailability busySql error]', busyErr);
            }

            // จัดกลุ่มรายการติดสอนตาม day_time (ยกเว้นวิชาเดียวกันที่กำลังเปิดแก้ไข)
            const busyMap = {};
            busyRows.forEach((b) => {
                const bCourseNo = (b.COURSE_NO || '').trim().toUpperCase();
                if (currentCourseNo && bCourseNo === currentCourseNo) {
                    return; // ข้ามวิชาตัวเองที่กำลังเปิดแก้ไข ไม่นำมานับว่าติดสอนชนกับตัวเอง
                }
                const key = `${b.DAY_CODE}_${b.TIME_CODE}`;
                if (!busyMap[key]) busyMap[key] = [];
                busyMap[key].push({
                    instructorCode: b.INSTRUCTOR_CODE,
                    instructorName: `${b.RANK_NAME_THAI_S || ''} ${b.INSTRUCTOR_NAME_THAI || b.INSTRUCTOR_CODE}`.trim(),
                    courseNo: b.COURSE_NO,
                    courseName: b.COURSE_NAME_THAI || ''
                });
            });

            // 5. คำนวณ Slot Matrix ทั้งหมด โดยเปรียบเทียบช่วงเวลาชนกับ มร.30 และ ตารางในคณะ
            const allSlots = [];
            const commonFreeSlots = [];

            days.forEach((d) => {
                times.forEach((t) => {
                    const key = `${d.dayCode}_${t.timeCode}`;
                    const classBusyList = busyMap[key] || [];

                    // ตรวจสอบว่าในคาบเวลานี้ของ RG_SCHEDULE_TIME ชนกับเวลาที่อาจารย์มีสอนใน มร.30 (UGB_RU30) หรือไม่
                    const ru30BusyList = [];
                    for (const r of ru30Rows) {
                        if (Number(r.DAY_CODE) === d.dayCode && isTimeOverlapping(t.timeStart, t.timeEnd, r.RU30_START, r.RU30_END)) {
                            const instName = `${r.RANK_NAME_THAI_S || ''} ${r.INSTRUCTOR_NAME_THAI || r.INSTRUCTOR_CODE}`.trim();
                            const ruPeriod = (r.RU30_START && r.RU30_END)
                                ? `${formatMilitaryTime(r.RU30_START)} - ${formatMilitaryTime(r.RU30_END)}`
                                : '';
                            ru30BusyList.push({
                                instructorCode: r.INSTRUCTOR_CODE,
                                instructorName: instName,
                                courseNo: r.RU30_COURSE_NO,
                                courseName: r.RU30_COURSE_NAME || '',
                                period: ruPeriod,
                                timeStart: r.RU30_START,
                                timeEnd: r.RU30_END
                            });
                        }
                    }

                    const isBusyInRu30 = ru30BusyList.length > 0;
                    const isBusyInClass = classBusyList.length > 0;
                    const isAvailable = !isBusyInRu30 && !isBusyInClass;

                    const slotObj = {
                        dayCode: d.dayCode,
                        timeCode: t.timeCode,
                        dayLabel: d.dayLabel,
                        dayShort: d.dayShort,
                        colorClass: d.colorClass,
                        period: t.period,
                        timeLabel: t.label,
                        timeStart: t.timeStart,
                        timeEnd: t.timeEnd,
                        isRu30Available: !isBusyInRu30, // backward compatible: true หากไม่ติดสอน มร.30
                        isBusyInRu30: isBusyInRu30,
                        ru30BusyCount: ru30BusyList.length,
                        ru30BusyList: ru30BusyList,
                        isBusyInClass: isBusyInClass,
                        busyCount: classBusyList.length,
                        busyList: classBusyList,
                        isAvailable: isAvailable
                    };

                    allSlots.push(slotObj);

                    if (isAvailable) {
                        commonFreeSlots.push(slotObj);
                    }
                });
            });

            return res.status(200).json({
                success: true,
                totalInstructors: uniqueCodes.length,
                hasRu30Schedule: ru30Rows.length > 0,
                ru30CandidateSlots: commonFreeSlots,
                commonFreeSlots: commonFreeSlots,
                slots: allSlots,
                allWeekSlots: allSlots,
            });
        } catch (error) {
            console.error('[TimetableQueryController.getInstructorAvailability error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, slots: [], commonFreeSlots: [] });
            }
        }
    },

    // 3.10 ตรวจสอบอาจารย์ที่สามารถสอนได้ในวันและคาบเวลาที่เลือก (Slot Available Instructors)
    async getSlotAvailableInstructors(req, res) {
        try {
            const { year, semester, dayCode, timeCodes, courseNo } = req.query;
            const currentCourseNo = (courseNo || '').toString().trim().toUpperCase();

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

            const targetDay = Number(dayCode);
            const targetTimes = typeof timeCodes === 'string'
                ? timeCodes.split(',').map(t => Number(t.trim())).filter(t => !isNaN(t) && t >= 1 && t <= 7)
                : (Array.isArray(timeCodes) ? timeCodes.map(t => Number(t)).filter(t => !isNaN(t) && t >= 1 && t <= 7) : []);

            if (!targetDay || targetTimes.length === 0) {
                return res.status(200).json({
                    success: true,
                    dayCode: targetDay,
                    timeCodes: targetTimes,
                    availableCodes: [],
                    busyCodes: [],
                    instructorsStatus: {}
                });
            }

            // 1. ดึงอาจารย์ทั้งหมดในปี/ภาคนี้
            const instSql = `
                SELECT 
                    TRIM(ri.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ui.INSTRUCTOR_NAME_ENG) AS INSTRUCTOR_NAME_ENG,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S
                FROM RG_SCHEDULE_INSTRUCTOR ri
                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ri.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                WHERE TRIM(ri.STUDY_YEAR) = :1 AND TRIM(ri.STUDY_SEMESTER) = :2
            `;
            const instRes = await SelectModel.findAll(res, instSql, [targetYear, targetSem]);
            const allInstructors = instRes?.rows || [];
            const allCodes = allInstructors.map(i => i.INSTRUCTOR_CODE).filter(Boolean);

            if (allCodes.length === 0) {
                return res.status(200).json({
                    success: true,
                    dayCode: targetDay,
                    timeCodes: targetTimes,
                    availableCodes: [],
                    busyCodes: [],
                    instructorsStatus: {}
                });
            }

            // 2. ดึงรายการที่อาจารย์ติดสอนในวันและคาบเหล่านี้ (จาก RG_SCHEDULE_CLASS + RG_SCHEDULE_TEACH)
            const timeInClause = targetTimes.map((_, idx) => `:${idx + 4}`).join(', ');
            const busyParams = [targetYear, targetSem, targetDay, ...targetTimes];
            const busySql = `
                SELECT DISTINCT
                    TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    rc.DAY_CODE,
                    rc.TIME_CODE,
                    TRIM(rc.COURSE_NO) AS COURSE_NO,
                    TRIM(uc.COURSE_NAME_THAI) AS COURSE_NAME_THAI
                FROM RG_SCHEDULE_CLASS rc
                JOIN RG_SCHEDULE_TEACH rt 
                    ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR) 
                   AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER) 
                   AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(rt.INSTRUCTOR_GROUP)
                LEFT JOIN (
                    SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI 
                    FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                ) uc ON TRIM(rc.COURSE_NO) = uc.COURSE_NO
                WHERE TRIM(rc.STUDY_YEAR) = :1 
                  AND TRIM(rc.STUDY_SEMESTER) = :2
                  AND rc.DAY_CODE = :3
                  AND rc.TIME_CODE IN (${timeInClause})
            `;
            const busyRes = await SelectModel.findAll(res, busySql, busyParams);
            const busyRows = busyRes?.rows || [];

            const instructorBusyMap = {};
            busyRows.forEach(b => {
                const bCourse = (b.COURSE_NO || '').trim().toUpperCase();
                if (currentCourseNo && bCourse === currentCourseNo) {
                    return; // ข้ามวิชาตัวเองที่กำลังแก้ไข ไม่ถือว่าชนกับตัวเอง
                }
                const code = b.INSTRUCTOR_CODE;
                if (!instructorBusyMap[code]) {
                    instructorBusyMap[code] = [];
                }
                instructorBusyMap[code].push({
                    dayCode: b.DAY_CODE,
                    timeCode: b.TIME_CODE,
                    courseNo: b.COURSE_NO,
                    courseName: b.COURSE_NAME_THAI || ''
                });
            });

            // 3. ดึงเวลาของคาบเป้าหมายจาก RG_SCHEDULE_TIME (timeFlag = 2 หากเป็นภาค 3, นอกนั้น 1)
            const isSummer = targetSem === '3' || targetSem.toUpperCase() === 'S';
            const timeFlag = isSummer ? '2' : '1';
            let targetSlotTimes = [];
            try {
                const inTimeP = targetTimes.map((_, i) => `:${i + 2}`).join(', ');
                const timeSql = `
                    SELECT TRIM(TIME_CODE) AS TIME_CODE, TRIM(TIME_START) AS TIME_START, TRIM(TIME_END) AS TIME_END
                    FROM RG_SCHEDULE_TIME
                    WHERE TRIM(TIME_FLAG) = :1 AND TRIM(TIME_CODE) IN (${inTimeP})
                `;
                const timeRes = await SelectModel.findAll(res, timeSql, [timeFlag, ...targetTimes.map(String)]);
                targetSlotTimes = (timeRes?.rows || []).map(r => ({
                    timeCode: Number(r.TIME_CODE),
                    timeStart: r.TIME_START,
                    timeEnd: r.TIME_END
                }));
            } catch (tErr) {
                console.error('[getSlotAvailableInstructors timeSql error]', tErr);
            }

            // Fallback ถ้าไม่มีข้อมูลใน RG_SCHEDULE_TIME
            if (targetSlotTimes.length === 0) {
                const defaultTimes = timeFlag === '2'
                    ? { 1: ['0835', '0950'], 2: ['0955', '1110'], 3: ['1115', '1230'], 4: ['1235', '1350'], 5: ['1355', '1510'] }
                    : { 1: ['0800', '0915'], 2: ['0925', '1040'], 3: ['1050', '1205'], 4: ['1215', '1330'], 5: ['1340', '1455'], 6: ['1505', '1620'] };
                targetSlotTimes = targetTimes.map(t => ({
                    timeCode: t,
                    timeStart: defaultTimes[t] ? defaultTimes[t][0] : '0800',
                    timeEnd: defaultTimes[t] ? defaultTimes[t][1] : '0915'
                }));
            }

            // 4. ดึง RU30 ของอาจารย์ทั้งหมดในปี/ภาคนี้ พร้อมเวลาจาก UGB_TIME_SCHEDULE
            let ru30Rows = [];
            try {
                const inInstP = allCodes.map((_, i) => `:${i + 4}`).join(', ');
                const ru30Sql = `
                    SELECT DISTINCT 
                        TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                        ru.DAY_CODE,
                        ru.TIME_CODE AS RU30_TIME_CODE,
                        TRIM(ts.TIME_START) AS RU30_START,
                        TRIM(ts.TIME_END) AS RU30_END,
                        TRIM(ru.COURSE_NO) AS RU30_COURSE_NO,
                        TRIM(uc.COURSE_NAME_THAI) AS RU30_COURSE_NAME
                    FROM UGB_RU30 ru
                    LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                    LEFT JOIN (
                        SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI 
                        FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                    ) uc ON TRIM(ru.COURSE_NO) = uc.COURSE_NO
                    WHERE TRIM(ru.STUDY_YEAR) = :1 
                      AND TRIM(ru.STUDY_SEMESTER) = :2
                      AND ru.DAY_CODE = :3
                      AND TRIM(ru.INSTRUCTOR_CODE) IN (${inInstP})
                `;
                const ru30Res = await SelectModel.findAll(res, ru30Sql, [targetYear, targetSem, targetDay, ...allCodes]);
                if (ru30Res && ru30Res.rows && ru30Res.rows.length > 0) {
                    ru30Rows = ru30Res.rows;
                } else {
                    const fbInInstP = allCodes.map((_, i) => `:${i + 2}`).join(', ');
                    const fbSql = `
                        SELECT DISTINCT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            ru.DAY_CODE,
                            ru.TIME_CODE AS RU30_TIME_CODE,
                            TRIM(ts.TIME_START) AS RU30_START,
                            TRIM(ts.TIME_END) AS RU30_END,
                            TRIM(ru.COURSE_NO) AS RU30_COURSE_NO,
                            TRIM(uc.COURSE_NAME_THAI) AS RU30_COURSE_NAME
                        FROM UGB_RU30 ru
                        LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                        LEFT JOIN (
                            SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI 
                            FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                        ) uc ON TRIM(ru.COURSE_NO) = uc.COURSE_NO
                        WHERE ru.DAY_CODE = :1
                          AND TRIM(ru.INSTRUCTOR_CODE) IN (${fbInInstP})
                    `;
                    const fbRes = await SelectModel.findAll(res, fbSql, [targetDay, ...allCodes]);
                    if (fbRes && fbRes.rows) ru30Rows = fbRes.rows;
                }
            } catch (ru30Err) {
                console.error('[getSlotAvailableInstructors ru30 error]', ru30Err);
            }

            // คำนวณความขัดแย้งเวลาของ มร.30 กับ targetSlotTimes
            const instRu30BusyMap = {};
            ru30Rows.forEach(r => {
                const code = (r.INSTRUCTOR_CODE || '').trim();
                for (const slot of targetSlotTimes) {
                    if (isTimeOverlapping(slot.timeStart, slot.timeEnd, r.RU30_START, r.RU30_END)) {
                        if (!instRu30BusyMap[code]) instRu30BusyMap[code] = [];
                        const ruPeriod = (r.RU30_START && r.RU30_END)
                            ? `${formatMilitaryTime(r.RU30_START)} - ${formatMilitaryTime(r.RU30_END)}`
                            : '';
                        instRu30BusyMap[code].push({
                            courseNo: r.RU30_COURSE_NO,
                            courseName: r.RU30_COURSE_NAME || '',
                            period: ruPeriod,
                            timeCode: slot.timeCode
                        });
                        break;
                    }
                }
            });

            // 5. สรุปสถานะอาจารย์แต่ละท่าน
            const availableCodes = [];
            const busyCodes = [];
            const instructorsStatus = {};

            allCodes.forEach(code => {
                const busyList = instructorBusyMap[code] || [];
                const isBusyInClass = busyList.length > 0;
                const ru30BusyList = instRu30BusyMap[code] || [];
                const isBusyInRu30 = ru30BusyList.length > 0;

                const isAvailable = !isBusyInClass && !isBusyInRu30;

                let reason = 'ว่างสอนในเวลานี้';
                let status = 'available';

                if (isBusyInClass) {
                    status = 'busy';
                    const uniqueCourses = Array.from(new Set(busyList.map(b => b.courseNo).filter(Boolean)));
                    reason = `ติดสอนวิชา ${uniqueCourses.join(', ')} ในคาบนี้`;
                    busyCodes.push(code);
                } else if (isBusyInRu30) {
                    status = 'ru30_busy';
                    const uniqueRuCourses = Array.from(new Set(ru30BusyList.map(b => b.courseNo).filter(Boolean)));
                    reason = `ติดสอนในระบบส่วนกลาง (มร.30) วิชา ${uniqueRuCourses.join(', ')}`;
                    busyCodes.push(code);
                } else {
                    availableCodes.push(code);
                }

                instructorsStatus[code] = {
                    isAvailable,
                    status,
                    reason,
                    isBusyInClass,
                    isBusyInRu30,
                    ru30BusyList,
                    busyCourses: busyList.map(b => b.courseNo)
                };
            });

            return res.status(200).json({
                success: true,
                dayCode: targetDay,
                timeCodes: targetTimes,
                totalInstructors: allCodes.length,
                availableCount: availableCodes.length,
                busyCount: busyCodes.length,
                availableCodes,
                busyCodes,
                instructorsStatus
            });
        } catch (error) {
            console.error('[TimetableQueryController.getSlotAvailableInstructors error]', error);
            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    message: error.message,
                    availableCodes: [],
                    busyCodes: [],
                    instructorsStatus: {}
                });
            }
        }
    },

    // 4.0 ดึงข้อมูลวันเรียนจากตาราง UGB_DAY_SCHEDULE (วันจันทร์ - อาทิตย์ รหัส 1-7, ไม่รวมตัวเลือกหลายวันควบ)
    async getDayOptions(req, res) {
        try {
            const sql = `
                SELECT 
                    DAY_CODE,
                    TRIM(DAY_NAME_S) AS DAY_NAME_S,
                    TRIM(DAY_NAME_L) AS DAY_NAME_L,
                    TRIM(DAY_NAME_STANDARD) AS DAY_NAME_STANDARD
                FROM UGB_DAY_SCHEDULE
                WHERE DAY_CODE BETWEEN 1 AND 7
                ORDER BY DAY_CODE ASC
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const dayNamesMap = {
                1: { label: 'วันจันทร์', short: 'จันทร์', colorClass: 'day-mon' },
                2: { label: 'วันอังคาร', short: 'อังคาร', colorClass: 'day-tue' },
                3: { label: 'วันพุธ', short: 'พุธ', colorClass: 'day-wed' },
                4: { label: 'วันพฤหัสบดี', short: 'พฤหัสบดี', colorClass: 'day-thu' },
                5: { label: 'วันศุกร์', short: 'ศุกร์', colorClass: 'day-fri' },
                6: { label: 'วันเสาร์', short: 'เสาร์', colorClass: 'day-sat' },
                7: { label: 'วันอาทิตย์', short: 'อาทิตย์', colorClass: 'day-sun' },
            };

            const rows = (result.rows || []).map((r) => {
                const code = Number(r.DAY_CODE);
                const info = dayNamesMap[code] || {
                    label: r.DAY_NAME_L || `วันรหัส ${code}`,
                    short: r.DAY_NAME_S || `${code}`,
                    colorClass: 'day-mon',
                };
                return {
                    code: code,
                    label: info.label,
                    shortLabel: info.short,
                    standardName: r.DAY_NAME_STANDARD || '',
                    colorClass: info.colorClass,
                };
            });

            // If empty, return standard fallback 1-7
            const finalRows = rows.length > 0 ? rows : [
                { code: 1, label: 'วันจันทร์', shortLabel: 'จันทร์', colorClass: 'day-mon' },
                { code: 2, label: 'วันอังคาร', shortLabel: 'อังคาร', colorClass: 'day-tue' },
                { code: 3, label: 'วันพุธ', shortLabel: 'พุธ', colorClass: 'day-wed' },
                { code: 4, label: 'วันพฤหัสบดี', shortLabel: 'พฤหัสบดี', colorClass: 'day-thu' },
                { code: 5, label: 'วันศุกร์', shortLabel: 'ศุกร์', colorClass: 'day-fri' },
                { code: 6, label: 'วันเสาร์', shortLabel: 'เสาร์', colorClass: 'day-sat' },
                { code: 7, label: 'วันอาทิตย์', shortLabel: 'อาทิตย์', colorClass: 'day-sun' },
            ];

            return res.status(200).json({ success: true, results: finalRows });
        } catch (error) {
            console.error('[TimetableQueryController.getDayOptions error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

    // 4.1 ดึงข้อมูลช่วงเวลาเรียนมาตรฐาน 7 คาบ (คาบที่ 1 - 7)
    // 10. ดึงคาบเวลามาตรฐานจาก RG_SCHEDULE_TIME (แยกภาคปกติ TIME_FLAG='1' 6 คาบ, ภาคฤดูร้อน TIME_FLAG='2' 5 คาบ)
    async getTimeSlots(req, res) {
        try {
            const { flag, semester } = req.query;
            let targetFlag = '1';
            if (flag) {
                targetFlag = flag.toString().trim() === '2' ? '2' : '1';
            } else if (semester) {
                const cleanSem = semester.toString().trim().toUpperCase();
                targetFlag = (cleanSem === '3' || cleanSem === 'S') ? '2' : '1';
            }

            const sql = `
                SELECT 
                    TRIM(TIME_CODE) AS TIME_CODE,
                    TRIM(TIME_START) AS TIME_START,
                    TRIM(TIME_END) AS TIME_END,
                    TRIM(TIME_FLAG) AS TIME_FLAG
                FROM RG_SCHEDULE_TIME
                WHERE TRIM(TIME_FLAG) = :1
                ORDER BY TO_NUMBER(TIME_CODE) ASC
            `;

            const result = await SelectModel.findAll(res, sql, [targetFlag]);
            let dbRows = (result && result.rows) ? result.rows : [];

            // Fallback เผื่อตาราง RG_SCHEDULE_TIME ใน DB ไม่มีข้อมูล
            if (dbRows.length === 0) {
                if (targetFlag === '2') {
                    dbRows = [
                        { TIME_CODE: '1', TIME_START: '0835', TIME_END: '0950', TIME_FLAG: '2' },
                        { TIME_CODE: '2', TIME_START: '0955', TIME_END: '1110', TIME_FLAG: '2' },
                        { TIME_CODE: '3', TIME_START: '1115', TIME_END: '1230', TIME_FLAG: '2' },
                        { TIME_CODE: '4', TIME_START: '1235', TIME_END: '1350', TIME_FLAG: '2' },
                        { TIME_CODE: '5', TIME_START: '1355', TIME_END: '1510', TIME_FLAG: '2' },
                    ];
                } else {
                    dbRows = [
                        { TIME_CODE: '1', TIME_START: '0800', TIME_END: '0915', TIME_FLAG: '1' },
                        { TIME_CODE: '2', TIME_START: '0925', TIME_END: '1040', TIME_FLAG: '1' },
                        { TIME_CODE: '3', TIME_START: '1050', TIME_END: '1205', TIME_FLAG: '1' },
                        { TIME_CODE: '4', TIME_START: '1215', TIME_END: '1330', TIME_FLAG: '1' },
                        { TIME_CODE: '5', TIME_START: '1340', TIME_END: '1455', TIME_FLAG: '1' },
                        { TIME_CODE: '6', TIME_START: '1505', TIME_END: '1620', TIME_FLAG: '1' },
                    ];
                }
            }

            const rows = dbRows.map(r => {
                const codeNum = Number(r.TIME_CODE);
                const start = formatMilitaryTime(r.TIME_START);
                const end = formatMilitaryTime(r.TIME_END);
                const period = `${start} - ${end}`;
                return {
                    code: codeNum,
                    TIME_CODE: String(codeNum),
                    TIME_START: r.TIME_START,
                    TIME_END: r.TIME_END,
                    TIME_FLAG: r.TIME_FLAG,
                    period: period,
                    label: `คาบที่ ${codeNum} (${period})`,
                };
            });

            return res.status(200).json({ success: true, results: rows });
        } catch (error) {
            console.error('[TimetableQueryController.getTimeSlots error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

    // 4.2 ดึงรายการห้องเรียนจาก RG_SCHEDULE_ROOM_DETAIL
    async getRoomOptions(req, res) {
        try {
            const sql = `
                SELECT 
                    TRIM(ROOM_CODE) AS ROOM_CODE,
                    TRIM(ROOM_DETAIL) AS ROOM_DETAIL
                FROM RG_SCHEDULE_ROOM_DETAIL
                ORDER BY ROOM_CODE ASC
            `;
            const result = await SelectModel.findAll(res, sql, []);
            const rows = result.rows || [];

            const results = rows.map((r) => {
                const roomCode = (r.ROOM_CODE || '').trim();
                const roomDetail = (r.ROOM_DETAIL || '').trim();
                let cleanLabel = roomDetail || (/^\d+$/.test(roomCode) ? `ห้อง ${roomCode}` : roomCode);
                cleanLabel = cleanLabel.replace(/^(ห้อง\s*)+/gi, 'ห้อง ').trim();
                return {
                    value: roomCode,
                    label: cleanLabel,
                    subLabel: undefined,
                    roomCode: roomCode,
                    roomDetail: roomDetail,
                };
            });

            return res.status(200).json({ success: true, results: results });
        } catch (error) {
            console.error('[TimetableQueryController.getRoomOptions error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

    // 4.3 ดึงรายการห้องเรียนที่มีตารางสอนจริงใน RG_SCHEDULE_CLASS (พร้อม Fallback RG_SCHEDULE_ROOM_DETAIL)
    async getScheduledRooms(req, res) {
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

            // 1. Query recently added rooms from RG_SCHEDULE_CLASS joined with RG_SCHEDULE_ROOM_DETAIL
            let recentSql = `
                SELECT 
                    TRIM(rc.ROOM_CODE) AS ROOM_CODE,
                    MAX(TRIM(rd.ROOM_DETAIL)) AS ROOM_DETAIL,
                    MAX(rc.INSERT_DATE) AS LATEST_INSERT
                FROM RG_SCHEDULE_CLASS rc
                LEFT JOIN RG_SCHEDULE_ROOM_DETAIL rd ON TRIM(rc.ROOM_CODE) = TRIM(rd.ROOM_CODE)
                WHERE rc.ROOM_CODE IS NOT NULL AND TRIM(rc.ROOM_CODE) IS NOT NULL
            `;
            const recentParams = [];
            if (targetYear && targetSem) {
                recentSql += ` AND TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2`;
                recentParams.push(targetYear, targetSem);
            }
            recentSql += ` GROUP BY TRIM(rc.ROOM_CODE) ORDER BY MAX(rc.INSERT_DATE) DESC, TRIM(rc.ROOM_CODE) ASC`;

            const recentRes = await SelectModel.findAll(res, recentSql, recentParams);
            const recentRows = recentRes.rows || [];
            const recentRooms = recentRows.map(r => {
                const code = (r.ROOM_CODE || '').trim();
                const detail = (r.ROOM_DETAIL || '').trim();
                let cleanLabel = detail || (/^\d+$/.test(code) ? `ห้อง ${code}` : code);
                cleanLabel = cleanLabel.replace(/^(ห้อง\s*)+/gi, 'ห้อง ').trim();
                return {
                    value: code,
                    label: cleanLabel,
                    subLabel: undefined,
                };
            }).filter(r => r.value);

            // 2. Fallback to all rooms from RG_SCHEDULE_ROOM_DETAIL if needed
            const roomSet = new Set();
            const results = [...recentRooms];
            results.forEach(r => roomSet.add(r.value));

            const allRoomsSql = `
                SELECT TRIM(ROOM_CODE) AS ROOM_CODE, TRIM(ROOM_DETAIL) AS ROOM_DETAIL
                FROM RG_SCHEDULE_ROOM_DETAIL
                ORDER BY ROOM_CODE ASC
            `;
            const allRoomsRes = await SelectModel.findAll(res, allRoomsSql, []);
            (allRoomsRes.rows || []).forEach((r) => {
                const roomCode = (r.ROOM_CODE || '').trim();
                const roomDetail = (r.ROOM_DETAIL || '').trim();
                let cleanLabel = roomDetail || (/^\d+$/.test(roomCode) ? `ห้อง ${roomCode}` : roomCode);
                cleanLabel = cleanLabel.replace(/^(ห้อง\s*)+/gi, 'ห้อง ').trim();
                if (roomCode && !roomSet.has(roomCode)) {
                    roomSet.add(roomCode);
                    results.push({
                        value: roomCode,
                        label: cleanLabel,
                        subLabel: undefined,
                    });
                }
            });

            // Sorted list for dropdown
            const sortedResults = [...results].sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' }));

            return res.status(200).json({
                success: true,
                currentYear: targetYear,
                currentSemester: targetSem,
                results: sortedResults,
                recentRooms: recentRooms.length > 0 ? recentRooms : sortedResults.slice(0, 8),
            });
        } catch (error) {
            console.error('[TimetableQueryController.getScheduledRooms error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message, results: [] });
            }
        }
    },

    // 8. ตรวจจับการชน/ซ้อนของอาจารย์ (Instructor Overlap Conflict Check)
    async checkInstructorConflicts(req, res) {
        try {
            const { year, semester, dayCode, timeCode, instructorCodes, excludeCourseNo } = req.query;
            if (!year || !semester || dayCode === undefined || timeCode === undefined || !instructorCodes) {
                return res.status(200).json({ success: true, hasConflict: false, conflicts: [] });
            }

            const cleanYear = year.toString().trim();
            const cleanSem = semester.toString().trim();
            const cleanDay = Number(dayCode);
            const cleanTime = Number(timeCode);
            const cleanExclude = (excludeCourseNo || '').toString().trim().toUpperCase();

            const rawCodes = (typeof instructorCodes === 'string' ? instructorCodes.split(',') : instructorCodes)
                .map(c => (c || '').toString().trim())
                .filter(Boolean);
            const uniqueCodes = Array.from(new Set(rawCodes));

            if (uniqueCodes.length === 0) {
                return res.status(200).json({ success: true, hasConflict: false, conflicts: [] });
            }

            const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 5}`).join(', ');
            const params = [cleanYear, cleanSem, cleanDay, cleanTime, ...uniqueCodes];

            let excludeClause = '';
            if (cleanExclude) {
                excludeClause = `AND UPPER(TRIM(rc.COURSE_NO)) != UPPER(TRIM(:${params.length + 1}))`;
                params.push(cleanExclude);
            }

            const sql = `
                SELECT 
                    TRIM(rc.COURSE_NO) AS COURSE_NO,
                    TRIM(uc.COURSE_NAME_THAI) AS COURSE_NAME_THAI,
                    TRIM(rc.ROOM_CODE) AS ROOM_CODE,
                    rc.DAY_CODE,
                    rc.TIME_CODE,
                    TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S
                FROM RG_SCHEDULE_CLASS rc
                JOIN RG_SCHEDULE_TEACH rt 
                    ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR) 
                   AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER) 
                   AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(rt.INSTRUCTOR_GROUP)
                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                LEFT JOIN (
                    SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI 
                    FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                ) uc ON TRIM(rc.COURSE_NO) = uc.COURSE_NO
                WHERE TRIM(rc.STUDY_YEAR) = :1 
                  AND TRIM(rc.STUDY_SEMESTER) = :2
                  AND rc.DAY_CODE = :3
                  AND rc.TIME_CODE = :4
                  AND TRIM(rt.INSTRUCTOR_CODE) IN (${inPlaceholders})
                  ${excludeClause}
            `;

            const queryRes = await SelectModel.findAll(res, sql, params);
            const rows = queryRes?.rows || [];

            const conflicts = rows.map(r => ({
                instructorCode: r.INSTRUCTOR_CODE,
                instructorName: `${r.RANK_NAME_THAI_S || ''} ${r.INSTRUCTOR_NAME_THAI || r.INSTRUCTOR_CODE}`.trim(),
                courseNo: r.COURSE_NO,
                courseName: r.COURSE_NAME_THAI || '',
                roomCode: r.ROOM_CODE || '-',
                dayCode: r.DAY_CODE,
                timeCode: r.TIME_CODE,
                message: `${r.RANK_NAME_THAI_S || ''} ${r.INSTRUCTOR_NAME_THAI || r.INSTRUCTOR_CODE} มีสอนวิชา ${r.COURSE_NO} (ห้อง ${r.ROOM_CODE || '-'}) ในคาบนี้แล้ว`
            }));

            return res.status(200).json({
                success: true,
                hasConflict: conflicts.length > 0,
                conflicts
            });
        } catch (error) {
            console.error('[TimetableQueryController.checkInstructorConflicts error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    // 9. ระบบแนะนำคาบและห้องว่างที่เหมาะสม (Smart Slot Recommender)
    async recommendSlots(req, res) {
        try {
            const { year, semester, instructorCodes, preferredRoom } = req.query;
            if (!year || !semester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีและภาคการศึกษา' });
            }

            const cleanYear = year.toString().trim();
            const cleanSem = semester.toString().trim();

            const rawCodes = instructorCodes
                ? (typeof instructorCodes === 'string' ? instructorCodes.split(',') : instructorCodes)
                    .map(c => (c || '').toString().trim())
                    .filter(Boolean)
                : [];
            const uniqueCodes = Array.from(new Set(rawCodes));

            // 1. ดึงช่วงเวลาเรียนจาก RG_SCHEDULE_TIME (timeFlag = 2 หากเป็นภาค 3, นอกนั้น 1)
            const isSummer = cleanSem === '3' || cleanSem.toUpperCase() === 'S';
            const timeFlag = isSummer ? '2' : '1';
            let timeSlots = [];
            try {
                const timeSql = `
                    SELECT 
                        TRIM(TIME_CODE) AS TIME_CODE,
                        TRIM(TIME_START) AS TIME_START,
                        TRIM(TIME_END) AS TIME_END
                    FROM RG_SCHEDULE_TIME
                    WHERE TRIM(TIME_FLAG) = :1
                    ORDER BY TO_NUMBER(TIME_CODE) ASC
                `;
                const timeRes = await SelectModel.findAll(res, timeSql, [timeFlag]);
                let dbRows = timeRes?.rows || [];
                if (dbRows.length === 0) {
                    dbRows = timeFlag === '2'
                        ? [
                            { TIME_CODE: '1', TIME_START: '0835', TIME_END: '0950' },
                            { TIME_CODE: '2', TIME_START: '0955', TIME_END: '1110' },
                            { TIME_CODE: '3', TIME_START: '1115', TIME_END: '1230' },
                            { TIME_CODE: '4', TIME_START: '1235', TIME_END: '1350' },
                            { TIME_CODE: '5', TIME_START: '1355', TIME_END: '1510' },
                        ]
                        : [
                            { TIME_CODE: '1', TIME_START: '0800', TIME_END: '0915' },
                            { TIME_CODE: '2', TIME_START: '0925', TIME_END: '1040' },
                            { TIME_CODE: '3', TIME_START: '1050', TIME_END: '1205' },
                            { TIME_CODE: '4', TIME_START: '1215', TIME_END: '1330' },
                            { TIME_CODE: '5', TIME_START: '1340', TIME_END: '1455' },
                            { TIME_CODE: '6', TIME_START: '1505', TIME_END: '1620' },
                        ];
                }
                timeSlots = dbRows.map(r => ({
                    timeCode: Number(r.TIME_CODE),
                    timeStart: r.TIME_START,
                    timeEnd: r.TIME_END,
                    period: `${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)}`,
                    label: `คาบที่ ${r.TIME_CODE} (${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)})`
                }));
            } catch (tErr) {
                console.error('[recommendSlots timeSql error]', tErr);
            }

            // 2. ดึงคาบสอนที่อาจารย์มีสอนอยู่แล้วในระบบส่วนกลาง มร.30 (UGB_RU30)
            let ru30Rows = [];
            if (uniqueCodes.length > 0) {
                try {
                    const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 3}`).join(', ');
                    const ru30Sql = `
                        SELECT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            ru.DAY_CODE AS DAY_CODE,
                            ru.TIME_CODE AS RU30_TIME_CODE,
                            TRIM(ts.TIME_START) AS RU30_START,
                            TRIM(ts.TIME_END) AS RU30_END,
                            TRIM(ru.COURSE_NO) AS RU30_COURSE_NO
                        FROM UGB_RU30 ru
                        LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                        WHERE TRIM(ru.STUDY_YEAR) = :1
                          AND TRIM(ru.STUDY_SEMESTER) = :2
                          AND TRIM(ru.INSTRUCTOR_CODE) IN (${inPlaceholders})
                          AND ru.DAY_CODE BETWEEN 1 AND 7
                    `;
                    const ru30Res = await SelectModel.findAll(res, ru30Sql, [cleanYear, cleanSem, ...uniqueCodes]);
                    if (ru30Res && ru30Res.rows && ru30Res.rows.length > 0) {
                        ru30Rows = ru30Res.rows;
                    } else {
                        const fallbackInP = uniqueCodes.map((_, i) => `:${i + 1}`).join(', ');
                        const fbSql = `
                            SELECT 
                                TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                                ru.DAY_CODE AS DAY_CODE,
                                ru.TIME_CODE AS RU30_TIME_CODE,
                                TRIM(ts.TIME_START) AS RU30_START,
                                TRIM(ts.TIME_END) AS RU30_END,
                                TRIM(ru.COURSE_NO) AS RU30_COURSE_NO
                            FROM UGB_RU30 ru
                            LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                            WHERE TRIM(ru.INSTRUCTOR_CODE) IN (${fallbackInP})
                              AND ru.DAY_CODE BETWEEN 1 AND 7
                        `;
                        const fbRes = await SelectModel.findAll(res, fbSql, uniqueCodes);
                        if (fbRes && fbRes.rows) ru30Rows = fbRes.rows;
                    }
                } catch (ru30Err) {
                    console.error('[recommendSlots ru30Sql error]', ru30Err);
                }
            }

            // 3. ดึงคาบที่อาจารย์ติดสอนวิชาอื่นในระบบคณะแล้ว (จาก RG_SCHEDULE_CLASS + RG_SCHEDULE_TEACH)
            const busySlots = new Set();
            if (uniqueCodes.length > 0) {
                const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 3}`).join(', ');
                const busySql = `
                    SELECT DISTINCT rc.DAY_CODE, rc.TIME_CODE
                    FROM RG_SCHEDULE_CLASS rc
                    JOIN RG_SCHEDULE_TEACH rt 
                        ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR) 
                       AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER) 
                       AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(rt.INSTRUCTOR_GROUP)
                    WHERE TRIM(rc.STUDY_YEAR) = :1 
                      AND TRIM(rc.STUDY_SEMESTER) = :2
                      AND TRIM(rt.INSTRUCTOR_CODE) IN (${inPlaceholders})
                `;
                const busyRes = await SelectModel.findAll(res, busySql, [cleanYear, cleanSem, ...uniqueCodes]);
                (busyRes?.rows || []).forEach(r => {
                    busySlots.add(`${r.DAY_CODE}_${r.TIME_CODE}`);
                });
            }

            // 4. ดึงห้องเรียนทั้งหมดจาก RG_SCHEDULE_ROOM_DETAIL
            let availableRoomsMaster = [];
            try {
                const allRoomsSql = `
                    SELECT 
                        TRIM(ROOM_CODE) AS ROOM_CODE,
                        TRIM(ROOM_DETAIL) AS ROOM_DETAIL
                    FROM RG_SCHEDULE_ROOM_DETAIL
                    WHERE ROOM_CODE IS NOT NULL AND TRIM(ROOM_CODE) != '-'
                    ORDER BY ROOM_CODE ASC
                `;
                const roomsRes = await SelectModel.findAll(res, allRoomsSql, []);
                if (roomsRes && roomsRes.rows && roomsRes.rows.length > 0) {
                    availableRoomsMaster = roomsRes.rows.map(r => {
                        const code = (r.ROOM_CODE || '').trim();
                        const detail = (r.ROOM_DETAIL || '').trim();
                        return {
                            roomCode: code,
                            roomDetail: detail || (/^\d+$/.test(code) ? `ห้อง ${code}` : code)
                        };
                    });
                }
            } catch (rErr) {
                console.error('[recommendSlots rooms master error]', rErr);
            }

            // Fallback ถ้าใน RG_SCHEDULE_ROOM_DETAIL ไม่มีข้อมูล
            if (availableRoomsMaster.length === 0) {
                const fbSql = `
                    SELECT DISTINCT TRIM(ROOM_CODE) AS ROOM_CODE
                    FROM RG_SCHEDULE_CLASS
                    WHERE ROOM_CODE IS NOT NULL AND TRIM(ROOM_CODE) != '-'
                    ORDER BY ROOM_CODE ASC
                `;
                const fbRes = await SelectModel.findAll(res, fbSql, []);
                if (fbRes?.rows?.length > 0) {
                    availableRoomsMaster = fbRes.rows.map(r => ({
                        roomCode: r.ROOM_CODE,
                        roomDetail: /^\d+$/.test(r.ROOM_CODE) ? `ห้อง ${r.ROOM_CODE}` : r.ROOM_CODE
                    }));
                } else {
                    availableRoomsMaster = ['1', '2', '3', '4', '5'].map(r => ({
                        roomCode: r,
                        roomDetail: `ห้อง ${r}`
                    }));
                }
            }

            // 5. ดึงคาบที่แต่ละห้องถูกจองแล้วในปี/ภาคนี้
            const roomOccupiedSql = `
                SELECT TRIM(ROOM_CODE) AS ROOM_CODE, DAY_CODE, TIME_CODE, TRIM(COURSE_NO) AS COURSE_NO
                FROM RG_SCHEDULE_CLASS
                WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                  AND ROOM_CODE IS NOT NULL AND TRIM(ROOM_CODE) != '-'
            `;
            const roomOccupiedRes = await SelectModel.findAll(res, roomOccupiedSql, [cleanYear, cleanSem]);
            const occupiedMap = {};
            (roomOccupiedRes?.rows || []).forEach(r => {
                occupiedMap[`${r.ROOM_CODE}_${r.DAY_CODE}_${r.TIME_CODE}`] = r.COURSE_NO;
            });

            const dayNames = {
                1: 'วันจันทร์', 2: 'วันอังคาร', 3: 'วันพุธ', 4: 'วันพฤหัสบดี',
                5: 'วันศุกร์', 6: 'วันเสาร์', 7: 'วันอาทิตย์'
            };

            const recommendations = [];

            // ตรวจสอบวันจันทร์ - อาทิตย์ และคาบจาก RG_SCHEDULE_TIME
            for (let day = 1; day <= 7; day++) {
                for (const tSlot of timeSlots) {
                    const time = tSlot.timeCode;
                    const slotKey = `${day}_${time}`;

                    // ก. ตรวจสอบว่าอาจารย์ท่านใดท่านหนึ่งติดสอนในคณะแล้วหรือไม่
                    if (busySlots.has(slotKey)) continue;

                    // ข. ตรวจสอบว่าอาจารย์ติดสอนในระบบส่วนกลาง มร.30 (ช่วงเวลาคาบนี้ชนกับ มร.30 หรือไม่)
                    const hasRu30Conflict = ru30Rows.some(r =>
                        Number(r.DAY_CODE) === day &&
                        isTimeOverlapping(tSlot.timeStart, tSlot.timeEnd, r.RU30_START, r.RU30_END)
                    );
                    if (hasRu30Conflict) continue;

                    // ค. หาห้องเรียนที่ยังว่างในคาบนี้ (จากห้องทั้งหมดในระบบ)
                    const freeRoomsInSlot = availableRoomsMaster.filter(
                        room => !occupiedMap[`${room.roomCode}_${day}_${time}`]
                    );

                    if (freeRoomsInSlot.length > 0) {
                        const prefCode = preferredRoom ? preferredRoom.toString().trim() : '';
                        const hasPrefRoom = prefCode && freeRoomsInSlot.some(r => r.roomCode === prefCode);
                        const suggestedObj = hasPrefRoom
                            ? freeRoomsInSlot.find(r => r.roomCode === prefCode)
                            : freeRoomsInSlot[0];

                        // คำนวณคะแนนความเหมาะสม (Priority Score)
                        let score = 0;
                        if (hasPrefRoom) score += 40;
                        if (time >= 2 && time <= 4) score += 20; // คาบกลางวันเป็นที่นิยม
                        else if (time === 1 || time === 5) score += 10;
                        else score += 5;

                        if (day <= 5) score += 15; // จันทร์ - ศุกร์

                        recommendations.push({
                            dayCode: day,
                            dayLabel: dayNames[day],
                            timeCode: time,
                            timeLabel: tSlot.label,
                            period: tSlot.period,
                            availableRooms: freeRoomsInSlot,
                            suggestedRoom: suggestedObj ? suggestedObj.roomCode : freeRoomsInSlot[0].roomCode,
                            score: score
                        });
                    }
                }
            }

            // เรียงลำดับจากคะแนนมากไปน้อย (คาบที่เหมาะสมที่สุดอยู่บนสุด)
            recommendations.sort((a, b) => b.score - a.score);

            return res.status(200).json({
                success: true,
                totalAvailableSlots: recommendations.length,
                recommendations: recommendations.slice(0, 20),
            });
        } catch (error) {
            console.error('[TimetableQueryController.recommendSlots error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },
};

module.exports = TimetableQueryController;
