const SelectModel = require('../../models/db/SelectModel');

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

            // 2. ดึงเวลาเรียนมาตรฐาน 7 คาบจาก UGB_TIME_SCHEDULE
            const standardTimes = [
                { timeCode: 1, period: '07:30 - 09:20', label: 'คาบที่ 1 (07:30 - 09:20)' },
                { timeCode: 2, period: '09:30 - 11:20', label: 'คาบที่ 2 (09:30 - 11:20)' },
                { timeCode: 3, period: '11:30 - 13:20', label: 'คาบที่ 3 (11:30 - 13:20)' },
                { timeCode: 4, period: '13:30 - 15:20', label: 'คาบที่ 4 (13:30 - 15:20)' },
                { timeCode: 5, period: '15:30 - 17:20', label: 'คาบที่ 5 (15:30 - 17:20)' },
                { timeCode: 6, period: '17:30 - 19:20', label: 'คาบที่ 6 (17:30 - 19:20)' },
                { timeCode: 7, period: '19:30 - 21:20', label: 'คาบที่ 7 (19:30 - 21:20)' },
            ];

            let times = [...standardTimes];
            try {
                const timeSql = `
                    SELECT 
                        TIME_CODE,
                        TRIM(TIME_START) AS TIME_START,
                        TRIM(TIME_END) AS TIME_END,
                        TRIM(TIME_RU30) AS TIME_RU30
                    FROM UGB_TIME_SCHEDULE
                    WHERE TIME_CODE BETWEEN 1 AND 7
                    ORDER BY TIME_CODE ASC
                `;
                const timeRes = await SelectModel.findAll(res, timeSql, []);
                if (timeRes && timeRes.rows && timeRes.rows.length > 0) {
                    times = standardTimes.map((std) => {
                        const found = timeRes.rows.find(r => Number(r.TIME_CODE) === std.timeCode);
                        if (found) {
                            const start = found.TIME_START && found.TIME_START.length === 4
                                ? `${found.TIME_START.slice(0, 2)}:${found.TIME_START.slice(2)}`
                                : std.period.split(' - ')[0];
                            const end = found.TIME_END && found.TIME_END.length === 4
                                ? `${found.TIME_END.slice(0, 2)}:${found.TIME_END.slice(2)}`
                                : std.period.split(' - ')[1];
                            const period = `${start} - ${end}`;
                            return {
                                timeCode: std.timeCode,
                                period: period,
                                label: `คาบที่ ${std.timeCode} (${period})`
                            };
                        }
                        return std;
                    });
                }
            } catch (timeErr) {
                console.error('[getInstructorAvailability timeSql error]', timeErr);
            }

            // 3. ดึงวันเวลาที่อาจารย์สามารถมาสอนได้จากตาราง UGB_RU30 (ตัดวันรหัส 0 ออก)
            let ru30Rows = [];
            try {
                const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 3}`).join(', ');
                const busyParams = [targetYear, targetSem, ...uniqueCodes];
                const ru30Sql = `
                    SELECT DISTINCT 
                        TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                        ru.DAY_CODE AS DAY_CODE,
                        ru.TIME_CODE AS TIME_CODE,
                        TRIM(ru.COURSE_NO) AS RU30_COURSE_NO
                    FROM UGB_RU30 ru
                    WHERE TRIM(ru.STUDY_YEAR) = :1 
                      AND TRIM(ru.STUDY_SEMESTER) = :2
                      AND TRIM(ru.INSTRUCTOR_CODE) IN (${inPlaceholders})
                      AND ru.DAY_CODE IS NOT NULL 
                      AND ru.DAY_CODE BETWEEN 1 AND 7
                      AND ru.TIME_CODE IS NOT NULL
                      AND ru.TIME_CODE BETWEEN 1 AND 7
                `;
                const ru30Res = await SelectModel.findAll(res, ru30Sql, busyParams);
                if (ru30Res && ru30Res.rows && ru30Res.rows.length > 0) {
                    ru30Rows = ru30Res.rows;
                } else {
                    // Fallback to all semesters in RU30 if specific year/sem has no records
                    const fallbackRu30Sql = `
                        SELECT DISTINCT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            ru.DAY_CODE AS DAY_CODE,
                            ru.TIME_CODE AS TIME_CODE,
                            TRIM(ru.COURSE_NO) AS RU30_COURSE_NO
                        FROM UGB_RU30 ru
                        WHERE TRIM(ru.INSTRUCTOR_CODE) IN (${uniqueCodes.map((_, i) => `:${i + 1}`).join(', ')})
                          AND ru.DAY_CODE IS NOT NULL 
                          AND ru.DAY_CODE BETWEEN 1 AND 7
                          AND ru.TIME_CODE IS NOT NULL
                          AND ru.TIME_CODE BETWEEN 1 AND 7
                    `;
                    const fallbackRes = await SelectModel.findAll(res, fallbackRu30Sql, uniqueCodes);
                    if (fallbackRes && fallbackRes.rows) {
                        ru30Rows = fallbackRes.rows;
                    }
                }
            } catch (ru30Err) {
                console.error('[getInstructorAvailability ru30Sql error]', ru30Err);
            }

            // จัดกลุ่ม RU30 slots ตามแต่ละอาจารย์
            const instRu30Map = {};
            uniqueCodes.forEach(code => {
                instRu30Map[code] = new Set();
            });

            ru30Rows.forEach(r => {
                const code = (r.INSTRUCTOR_CODE || '').trim();
                const key = `${r.DAY_CODE}_${r.TIME_CODE}`;
                if (instRu30Map[code]) {
                    instRu30Map[code].add(key);
                }
            });

            const instructorsWithRu30 = uniqueCodes.filter(code => instRu30Map[code] && instRu30Map[code].size > 0);

            // 4. ดึงคาบสอนที่อาจารย์เหล่านี้ถูกจัดตารางสอนวิชาอื่นไปแล้วในปี/ภาคนี้ (จาก RG_SCHEDULE_CLASS + RG_SCHEDULE_TEACH)
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

            // 5. คำนวณ Slot Matrix ทั้งหมด
            const allSlots = [];
            const commonFreeSlots = [];
            const ru30CandidateSlots = [];

            days.forEach((d) => {
                times.forEach((t) => {
                    const key = `${d.dayCode}_${t.timeCode}`;
                    const busyList = busyMap[key] || [];
                    const isBusyInClass = busyList.length > 0;

                    // ตรวจสอบว่าใน RU30 อาจารย์สอนคาบนี้หรือไม่ (กรณีมีหลายอาจารย์ ทุกคนที่มี RU30 ต้องสามารถสอนได้ในคาบนี้)
                    let isRu30Available = true;
                    if (instructorsWithRu30.length > 0) {
                        isRu30Available = instructorsWithRu30.every(code => instRu30Map[code].has(key));
                    }

                    // ความพร้อมใช้งาน: อยู่ใน RU30 (สามารถสอนได้) และยังไม่ติดสอนวิชาอื่นในระบบ
                    const isAvailable = isRu30Available && !isBusyInClass;

                    const slotObj = {
                        dayCode: d.dayCode,
                        timeCode: t.timeCode,
                        dayLabel: d.dayLabel,
                        dayShort: d.dayShort,
                        colorClass: d.colorClass,
                        period: t.period,
                        timeLabel: t.label,
                        isRu30Available: isRu30Available,
                        isBusyInClass: isBusyInClass,
                        isAvailable: isAvailable,
                        busyCount: busyList.length,
                        busyList: busyList
                    };

                    allSlots.push(slotObj);

                    // หากเป็นคาบที่อาจารย์สามารถมาสอนได้ตาม RU30
                    if (isRu30Available) {
                        ru30CandidateSlots.push(slotObj);
                        if (isAvailable) {
                            commonFreeSlots.push(slotObj);
                        }
                    }
                });
            });

            const finalSlots = ru30CandidateSlots.length > 0 ? ru30CandidateSlots : allSlots;
            const finalFreeSlots = commonFreeSlots.length > 0 ? commonFreeSlots : allSlots.filter(s => s.isAvailable);

            return res.status(200).json({
                success: true,
                totalInstructors: uniqueCodes.length,
                hasRu30Schedule: instructorsWithRu30.length > 0,
                ru30CandidateSlots: ru30CandidateSlots,
                commonFreeSlots: finalFreeSlots,
                slots: finalSlots,
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

            // 3. ดึง RU30 ของอาจารย์ทั้งหมดในปี/ภาคนี้
            let ru30Rows = [];
            try {
                const ru30Sql = `
                    SELECT DISTINCT 
                        TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                        ru.DAY_CODE,
                        ru.TIME_CODE
                    FROM UGB_RU30 ru
                    WHERE TRIM(ru.STUDY_YEAR) = :1 
                      AND TRIM(ru.STUDY_SEMESTER) = :2
                      AND ru.DAY_CODE IS NOT NULL 
                      AND ru.TIME_CODE IS NOT NULL
                `;
                const ru30Res = await SelectModel.findAll(res, ru30Sql, [targetYear, targetSem]);
                if (ru30Res && ru30Res.rows && ru30Res.rows.length > 0) {
                    ru30Rows = ru30Res.rows;
                } else {
                    const fbSql = `
                        SELECT DISTINCT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            ru.DAY_CODE,
                            ru.TIME_CODE
                        FROM UGB_RU30 ru
                        WHERE ru.DAY_CODE IS NOT NULL AND ru.TIME_CODE IS NOT NULL
                    `;
                    const fbRes = await SelectModel.findAll(res, fbSql, []);
                    if (fbRes && fbRes.rows) ru30Rows = fbRes.rows;
                }
            } catch (ru30Err) {
                console.error('[getSlotAvailableInstructors ru30 error]', ru30Err);
            }

            const instRu30Slots = {};
            ru30Rows.forEach(r => {
                const code = (r.INSTRUCTOR_CODE || '').trim();
                if (!instRu30Slots[code]) instRu30Slots[code] = new Set();
                instRu30Slots[code].add(`${r.DAY_CODE}_${r.TIME_CODE}`);
            });

            // 4. สรุปสถานะอาจารย์แต่ละท่าน
            const availableCodes = [];
            const busyCodes = [];
            const instructorsStatus = {};

            allCodes.forEach(code => {
                const busyList = instructorBusyMap[code] || [];
                const isBusy = busyList.length > 0;

                const hasRu30Records = !!(instRu30Slots[code] && instRu30Slots[code].size > 0);
                let isRu30Available = true;
                if (hasRu30Records) {
                    isRu30Available = targetTimes.every(t => instRu30Slots[code].has(`${targetDay}_${t}`));
                }

                const isAvailable = !isBusy && isRu30Available;

                let reason = 'ว่างสอนในเวลานี้';
                let status = 'available';

                if (isBusy) {
                    status = 'busy';
                    const uniqueCourses = Array.from(new Set(busyList.map(b => b.courseNo).filter(Boolean)));
                    reason = `ติดสอนวิชา ${uniqueCourses.join(', ')} ในคาบนี้`;
                    busyCodes.push(code);
                } else if (!isRu30Available) {
                    status = 'ru30_unavailable';
                    reason = 'ไม่ได้ลงเวลาสอนในคาบนี้ (มร.30)';
                    busyCodes.push(code);
                } else {
                    availableCodes.push(code);
                }

                instructorsStatus[code] = {
                    isAvailable,
                    status,
                    reason,
                    hasRu30Records,
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
    async getTimeSlots(req, res) {
        try {
            const standardTimes = [
                { code: 1, TIME_CODE: '1', TIME_START: '0730', TIME_END: '0920', period: '07:30 - 09:20', label: 'คาบที่ 1 (07:30 - 09:20)' },
                { code: 2, TIME_CODE: '2', TIME_START: '0930', TIME_END: '1120', period: '09:30 - 11:20', label: 'คาบที่ 2 (09:30 - 11:20)' },
                { code: 3, TIME_CODE: '3', TIME_START: '1130', TIME_END: '1320', period: '11:30 - 13:20', label: 'คาบที่ 3 (11:30 - 13:20)' },
                { code: 4, TIME_CODE: '4', TIME_START: '1330', TIME_END: '1520', period: '13:30 - 15:20', label: 'คาบที่ 4 (13:30 - 15:20)' },
                { code: 5, TIME_CODE: '5', TIME_START: '1530', TIME_END: '1720', period: '15:30 - 17:20', label: 'คาบที่ 5 (15:30 - 17:20)' },
                { code: 6, TIME_CODE: '6', TIME_START: '1730', TIME_END: '1920', period: '17:30 - 19:20', label: 'คาบที่ 6 (17:30 - 19:20)' },
                { code: 7, TIME_CODE: '7', TIME_START: '1930', TIME_END: '2120', period: '19:30 - 21:20', label: 'คาบที่ 7 (19:30 - 21:20)' },
            ];

            const sql = `
                SELECT 
                    TIME_CODE,
                    TRIM(TIME_START) AS TIME_START,
                    TRIM(TIME_END) AS TIME_END,
                    TRIM(TIME_RU30) AS TIME_RU30,
                    FLAG_DISPLAY
                FROM UGB_TIME_SCHEDULE
                WHERE TIME_CODE BETWEEN 1 AND 7
                ORDER BY TIME_CODE ASC
            `;

            const result = await SelectModel.findAll(res, sql, []);
            const dbRows = result.rows || [];

            // Combine DB records with standard 1-7 structure to guarantee 7 complete clean periods
            const rows = standardTimes.map((std) => {
                const found = dbRows.find(r => Number(r.TIME_CODE) === std.code);
                if (found) {
                    const start = found.TIME_START && found.TIME_START.length === 4
                        ? `${found.TIME_START.slice(0, 2)}:${found.TIME_START.slice(2)}`
                        : std.period.split(' - ')[0];
                    const end = found.TIME_END && found.TIME_END.length === 4
                        ? `${found.TIME_END.slice(0, 2)}:${found.TIME_END.slice(2)}`
                        : std.period.split(' - ')[1];
                    const period = `${start} - ${end}`;
                    return {
                        code: std.code,
                        TIME_CODE: String(std.code),
                        TIME_START: found.TIME_START || std.TIME_START,
                        TIME_END: found.TIME_END || std.TIME_END,
                        TIME_RU30: found.TIME_RU30 || null,
                        FLAG_DISPLAY: found.FLAG_DISPLAY != null ? found.FLAG_DISPLAY : 1,
                        period: period,
                        label: `คาบที่ ${std.code} (${period})`,
                    };
                }
                return std;
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

            // 1. ดึงข้อมูลเวลาว่างของอาจารย์ตาม มร.30 (UGB_RU30)
            let ru30Rows = [];
            if (uniqueCodes.length > 0) {
                try {
                    const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 1}`).join(', ');
                    const ru30Sql = `
                        SELECT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            ru.DAY_CODE AS DAY_CODE,
                            ru.TIME_CODE AS TIME_CODE
                        FROM UGB_RU30 ru
                        WHERE TRIM(ru.INSTRUCTOR_CODE) IN (${inPlaceholders})
                          AND ru.DAY_CODE BETWEEN 1 AND 7
                          AND ru.TIME_CODE BETWEEN 1 AND 7
                    `;
                    const ru30Res = await SelectModel.findAll(res, ru30Sql, uniqueCodes);
                    if (ru30Res && ru30Res.rows) {
                        ru30Rows = ru30Res.rows;
                    }
                } catch (ru30Err) {
                    console.error('[recommendSlots ru30Sql error]', ru30Err);
                }
            }

            // จัดกลุ่ม RU30 slots ตามแต่ละอาจารย์
            const instRu30Map = {};
            uniqueCodes.forEach(code => {
                instRu30Map[code] = new Set();
            });
            ru30Rows.forEach(r => {
                const code = (r.INSTRUCTOR_CODE || '').trim();
                const key = `${r.DAY_CODE}_${r.TIME_CODE}`;
                if (instRu30Map[code]) {
                    instRu30Map[code].add(key);
                }
            });
            const instructorsWithRu30 = uniqueCodes.filter(code => instRu30Map[code] && instRu30Map[code].size > 0);

            // 2. ดึงคาบที่อาจารย์ติดสอนวิชาอื่นในระบบแล้ว (จาก RG_SCHEDULE_CLASS + RG_SCHEDULE_TEACH)
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

            // 3. ดึงห้องเรียนทั้งหมดจาก RG_SCHEDULE_ROOM_DETAIL
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

            // 4. ดึงคาบที่แต่ละห้องถูกจองแล้วในปี/ภาคนี้
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
            const timeLabels = {
                1: '07:30 - 09:20', 2: '09:30 - 11:20', 3: '11:30 - 13:20',
                4: '13:30 - 15:20', 5: '15:30 - 17:20', 6: '17:30 - 19:20', 7: '19:30 - 21:20'
            };

            const recommendations = [];

            // ตรวจสอบวันจันทร์ - อาทิตย์ และคาบ 1 - 7
            for (let day = 1; day <= 7; day++) {
                for (let time = 1; time <= 7; time++) {
                    const slotKey = `${day}_${time}`;

                    // ก. ตรวจสอบว่าอาจารย์ท่านใดท่านหนึ่งติดสอนในระบบแล้วหรือไม่
                    if (busySlots.has(slotKey)) continue;

                    // ข. ตรวจสอบเวลาว่างของอาจารย์ตาม มร.30 (หากอาจารย์มีกำหนดไว้ใน มร.30)
                    if (instructorsWithRu30.length > 0) {
                        const allAvailableInRu30 = instructorsWithRu30.every(code => instRu30Map[code].has(slotKey));
                        if (!allAvailableInRu30) continue;
                    }

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
                            timeLabel: `คาบที่ ${time} (${timeLabels[time]})`,
                            period: timeLabels[time],
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
