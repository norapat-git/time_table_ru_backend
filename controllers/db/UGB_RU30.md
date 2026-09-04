DROP TABLE NORAPAT.UGB_RU30 CASCADE CONSTRAINTS;

CREATE TABLE NORAPAT.UGB_RU30
(
  CAMPUS_NO             NUMBER(1)               NOT NULL,
  STD_TYPE              NUMBER(2)               NOT NULL,
  STUDY_SEMESTER        CHAR(1 BYTE)            NOT NULL,
  STUDY_YEAR            CHAR(4 BYTE)            NOT NULL,
  COURSE_NO             VARCHAR2(7 BYTE)        NOT NULL,
  SECTION_NO            NUMBER(1)               NOT NULL,
  COURSE_METHOD         NUMBER(1)               NOT NULL,
  COURSE_METHOD_NUMBER  NUMBER(2),
  DAY_CODE              NUMBER(2),
  TIME_CODE             NUMBER(2),
  BUILDING_CODE         CHAR(5 BYTE),
  ROOM_CODE             CHAR(5 BYTE),
  SEQUENCE_INSTRUCTOR   NUMBER(2),
  INSTRUCTOR_CODE       CHAR(6 BYTE)
)
TABLESPACE SYSTEM
PCTUSED    40
PCTFREE    10
INITRANS   1
MAXTRANS   255
STORAGE    (
            INITIAL          64K
            NEXT             1M
            MINEXTENTS       1
            MAXEXTENTS       UNLIMITED
            PCTINCREASE      0
            FREELISTS        1
            FREELIST GROUPS  1
            BUFFER_POOL      DEFAULT
           )
LOGGING 
NOCOMPRESS 
NOCACHE;
