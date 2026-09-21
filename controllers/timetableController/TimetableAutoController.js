const SelectModel = require('../../models/db/SelectModel');
const DbTxModel = require('../../models/db/DbTxModel');

function formatMilitaryTime(t) {
    if (!t) return '';
    const str = t.toString().trim().padStart(4, '0');
    return `${str.slice(0, 2)}:${str.slice(2, 4)}`;
}

function sanitizeUsername(raw, defaultVal = 'ADMIN') {
    if (!raw) return defaultVal;
    const str = raw.toString().trim();
    if (!str) return defaultVal;
    const name = str.split('@')[0].trim();
    return name || defaultVal;
}

/**
 * TimetableAutoController
 * รับผิดชอบ: การจัดตารางสอนอัตโนมัติ และการคัดลอกตารางสอน
 *  - cloneSemester      → POST /timetable/clone-semester
 *  - autoScheduleSolve  → POST /timetable/auto-schedule/solve
 *  - autoScheduleApply  → POST /timetable/auto-schedule/apply
 */
const TimetableAutoController = {
    async cloneSemester(req, res) {
        try {
            const { sourceYear, sourceSemester, targetYear, targetSemester, mode, userInsert } = req.body;
            if (!sourceYear || !sourceSemester || !targetYear || !targetSemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปี/ภาคต้นทางและปลายทาง' });
            }

            const sYear = sourceYear.toString().trim();
            const sSem = sourceSemester.toString().trim();
            const tYear = targetYear.toString().trim();
            const tSem = targetSemester.toString().trim();
            const cloneMode = mode || 'merge';
            const user = sanitizeUsername(userInsert, 'ADMIN');

            if (sYear === tYear && sSem === tSem) {
                return res.status(400).json({ success: false, message: 'ปี/ภาคต้นทางและปลายทางต้องไม่ซ้ำกัน' });
            }

            let insertedClassesCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                if (cloneMode === 'replace') {
                    await tx.executeOne(`
                        INSERT INTO RG_SCHEDULE_CLASS_HIS (
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                        )
                        SELECT STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, SYSDATE, USER_INSERT, :1
                        FROM RG_SCHEDULE_CLASS
                        WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                    `, [user, tYear, tSem]);

                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_CLASS WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);

                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_TEACH WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);
                }

                const srcClassesSql = `
                    SELECT rc.* 
                    FROM RG_SCHEDULE_CLASS rc
                    WHERE TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2
                `;
                const srcClasses = await tx.fetchAll(srcClassesSql, [sYear, sSem]);

                if (!srcClasses || srcClasses.length === 0) {
                    throw new Error(`ไม่พบข้อมูลตารางสอนในปี ${sYear} ภาค ${sSem} ต้นทาง`);
                }

                const targetExisting = new Set();
                if (cloneMode === 'merge') {
                    const existingRes = await tx.fetchAll(`
                        SELECT TRIM(COURSE_NO) AS COURSE_NO FROM RG_SCHEDULE_CLASS WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);
                    (existingRes || []).forEach(r => targetExisting.add((r.COURSE_NO || '').trim().toUpperCase()));
                }

                const clonedInstrGroups = new Set();

                for (const item of srcClasses) {
                    const courseNo = (item.COURSE_NO || '').trim().toUpperCase();
                    if (cloneMode === 'merge' && targetExisting.has(courseNo)) {
                        continue;
                    }

                    await tx.executeOne(`
                        INSERT INTO RG_SCHEDULE_CLASS (
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, USER_INSERT
                        ) VALUES (:1, :2, :3, :4, :5, :6, :7, SYSDATE, :8)
                    `, [
                        tYear,
                        tSem,
                        courseNo,
                        item.DAY_CODE,
                        item.TIME_CODE,
                        item.ROOM_CODE,
                        item.INSTR_GROUP,
                        user
                    ]);

                    const groupKey = item.INSTR_GROUP ? item.INSTR_GROUP.toString().trim() : null;
                    if (groupKey && !clonedInstrGroups.has(groupKey)) {
                        clonedInstrGroups.add(groupKey);

                        const teaches = await tx.fetchAll(`
                            SELECT * FROM RG_SCHEDULE_TEACH 
                            WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_GROUP) = :3
                        `, [sYear, sSem, groupKey]);

                        for (const t of (teaches || [])) {
                            try {
                                await tx.executeOne(`
                                    INSERT INTO RG_SCHEDULE_TEACH (
                                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD, INSERT_DATE, USER_INSERT
                                    ) VALUES (:1, :2, :3, :4, :5, SYSDATE, :6)
                                `, [
                                    tYear,
                                    tSem,
                                    groupKey,
                                    t.INSTRUCTOR_CODE,
                                    t.INSTRUCTOR_ORD,
                                    user
                                ]);
                            } catch (teachErr) {
                                console.warn('[cloneSemester teach insert notice]', teachErr?.message);
                            }
                        }
                    }

                    insertedClassesCount++;
                }

                try {
                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP 
                        WHERE INSTR_GROUP NOT IN (
                            SELECT DISTINCT INSTR_GROUP 
                            FROM RG_SCHEDULE_CLASS 
                            WHERE INSTR_GROUP IS NOT NULL
                        )
                    `);
                } catch (e) {}
            });

            return res.status(200).json({
                success: true,
                message: `คัดลอกตารางสอนสำเร็จ ${insertedClassesCount} รายการ ไปยังปี ${tYear} ภาค ${tSem}`,
                insertedCount: insertedClassesCount
            });
        } catch (error) {
            console.error('[TimetableAutoController.cloneSemester error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async autoScheduleSolve(req, res) {
        try {
            const { studyYear, studySemester, courseNos, allowedRoomCodes, maxClassesPerDay, avoidEveningSlots } = req.body;
            if (!studyYear || !studySemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีและภาคการศึกษา' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const maxPerDay = Number(maxClassesPerDay) || 2;
            const skipEvening = avoidEveningSlots !== false;

            let coursesToSchedule = [];
            if (Array.isArray(courseNos) && courseNos.length > 0) {
                const inP = courseNos.map((_, i) => `:${i + 1}`).join(', ');
                const cSql = `
                    SELECT TRIM(c.COURSE_NO) AS COURSE_NO, MAX(TRIM(c.COURSE_NAME_THAI)) AS COURSE_NAME_THAI, MAX(c.CREDIT) AS CREDIT
                    FROM UGB_COURSE c
                    WHERE TRIM(c.COURSE_NO) IN (${inP})
                    GROUP BY TRIM(c.COURSE_NO)
                `;
                const cRes = await SelectModel.findAll(res, cSql, courseNos.map(c => c.toString().trim().toUpperCase()));
                coursesToSchedule = cRes?.rows || [];
            } else {
                const cSql = `
                    SELECT TRIM(c.COURSE_NO) AS COURSE_NO, MAX(TRIM(c.COURSE_NAME_THAI)) AS COURSE_NAME_THAI, MAX(c.CREDIT) AS CREDIT
                    FROM UGB_COURSE c
                    WHERE ROWNUM <= 25
                    GROUP BY TRIM(c.COURSE_NO)
                `;
                const cRes = await SelectModel.findAll(res, cSql, []);
                coursesToSchedule = cRes?.rows || [];
            }

            let rooms = [];
            if (Array.isArray(allowedRoomCodes) && allowedRoomCodes.length > 0) {
                rooms = allowedRoomCodes.map(r => r.toString().trim()).filter(Boolean);
            } else {
                rooms = ['1', '2', '3', '4', '5', '6'];
            }

            const occSql = `
                SELECT TRIM(ROOM_CODE) AS ROOM_CODE, DAY_CODE, TIME_CODE, TRIM(COURSE_NO) AS COURSE_NO
                FROM RG_SCHEDULE_CLASS
                WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
            `;
            const occRes = await SelectModel.findAll(res, occSql, [cleanYear, cleanSem]);
            const occupiedRooms = new Set();
            (occRes?.rows || []).forEach(r => {
                occupiedRooms.add(`${r.ROOM_CODE}_${r.DAY_CODE}_${r.TIME_CODE}`);
            });

            const proposedSchedule = [];
            const unassigned = [];
            const instDailyLoads = {};

            const dayNames = {
                1: 'วันจันทร์', 2: 'วันอังคาร', 3: 'วันพุธ', 4: 'วันพฤหัสบดี',
                5: 'วันศุกร์', 6: 'วันเสาร์', 7: 'วันอาทิตย์'
            };
            const isSummer = cleanSem === '3' || cleanSem.toUpperCase() === 'S';
            const timeFlag = isSummer ? '2' : '1';
            let timeSlots = [];
            try {
                const timeSql = `
                    SELECT TRIM(TIME_CODE) AS TIME_CODE, TRIM(TIME_START) AS TIME_START, TRIM(TIME_END) AS TIME_END
                    FROM RG_SCHEDULE_TIME
                    WHERE TRIM(TIME_FLAG) = :1
                    ORDER BY TO_NUMBER(TIME_CODE) ASC
                `;
                const timeRes = await SelectModel.findAll(res, timeSql, [timeFlag]);
                const dbRows = timeRes?.rows || [];
                if (dbRows.length > 0) {
                    timeSlots = dbRows.map(r => ({
                        timeCode: Number(r.TIME_CODE),
                        period: `${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)}`,
                        label: `คาบที่ ${r.TIME_CODE} (${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)})`
                    }));
                }
            } catch (tErr) {
                console.error('[autoScheduleSolve timeSql error]', tErr);
            }
            if (timeSlots.length === 0) {
                const fallbackRows = timeFlag === '2'
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
                timeSlots = fallbackRows.map(r => ({
                    timeCode: Number(r.TIME_CODE),
                    period: `${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)}`,
                    label: `คาบที่ ${r.TIME_CODE} (${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)})`
                }));
            }
            const timeSlotsMap = {};
            timeSlots.forEach(ts => { timeSlotsMap[ts.timeCode] = ts; });

            for (const course of coursesToSchedule) {
                const cNo = (course.COURSE_NO || '').trim().toUpperCase();
                let placed = false;

                dayLoop: for (let day = 1; day <= 5; day++) {
                    const maxTime = skipEvening ? 5 : 7;
                    for (let time = 1; time <= maxTime; time++) {
                        for (const room of rooms) {
                            const key = `${room}_${day}_${time}`;
                            if (!occupiedRooms.has(key)) {
                                const alreadyInDay = proposedSchedule.some(p => p.courseNo === cNo && p.dayCode === day);
                                if (alreadyInDay) continue;

                                occupiedRooms.add(key);
                                proposedSchedule.push({
                                    courseNo: cNo,
                                    courseName: course.COURSE_NAME_THAI || '',
                                    credit: course.CREDIT || 3,
                                    dayCode: day,
                                    dayLabel: dayNames[day],
                                    timeCode: time,
                                    timeLabel: timeSlotsMap[time]?.label || `คาบที่ ${time}`,
                                    period: timeSlotsMap[time]?.period || '',
                                    roomCode: room,
                                });
                                placed = true;
                                break dayLoop;
                            }
                        }
                    }
                }

                if (!placed) {
                    unassigned.push({
                        courseNo: cNo,
                        courseName: course.COURSE_NAME_THAI || '',
                        reason: 'ไม่มีห้องว่างตรงกับเงื่อนไขที่กำหนด'
                    });
                }
            }

            return res.status(200).json({
                success: true,
                totalRequested: coursesToSchedule.length,
                scheduledCount: proposedSchedule.length,
                unassignedCount: unassigned.length,
                proposedSchedule,
                unassigned
            });
        } catch (error) {
            console.error('[TimetableAutoController.autoScheduleSolve error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async autoScheduleApply(req, res) {
        try {
            const { studyYear, studySemester, items, userInsert } = req.body;
            if (!studyYear || !studySemester || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรายการที่ต้องการบันทึก' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const user = sanitizeUsername(userInsert, 'AUTO_SCHEDULER');

            let savedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const item of items) {
                    const cNo = (item.courseNo || '').trim().toUpperCase();
                    const day = Number(item.dayCode);
                    const time = Number(item.timeCode);
                    const room = (item.roomCode || '').trim();

                    if (!cNo || isNaN(day) || isNaN(time) || !room) continue;

                    const existRes = await tx.fetchAll(`
                        SELECT COUNT(*) AS CNT FROM RG_SCHEDULE_CLASS 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(COURSE_NO) = :3
                    `, [cleanYear, cleanSem, cNo]);

                    const count = Number(existRes?.[0]?.CNT || 0);
                    if (count > 0) {
                        await tx.executeOne(`
                            UPDATE RG_SCHEDULE_CLASS 
                            SET DAY_CODE = :1, TIME_CODE = :2, ROOM_CODE = :3, INSERT_DATE = SYSDATE, USER_INSERT = :4
                            WHERE TRIM(STUDY_YEAR) = :5 AND TRIM(STUDY_SEMESTER) = :6 AND TRIM(COURSE_NO) = :7
                        `, [day, time, room, user, cleanYear, cleanSem, cNo]);
                    } else {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_CLASS (
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSERT_DATE, USER_INSERT
                            ) VALUES (:1, :2, :3, :4, :5, :6, SYSDATE, :7)
                        `, [cleanYear, cleanSem, cNo, day, time, room, user]);
                    }
                    savedCount++;
                }
            });

            return res.status(200).json({
                success: true,
                message: `บันทึกผลการจัดตารางสอนสำเร็จ ${savedCount} รายการ`,
                savedCount
            });
        } catch (error) {
            console.error('[TimetableAutoController.autoScheduleApply error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    }
};

module.exports = TimetableAutoController;
