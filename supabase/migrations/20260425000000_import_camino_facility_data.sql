/*
  # Import Camino facility metadata (2025 SPCC Plan Updates)

  Renames each Survey-Route facility to its Camino-system counterpart,
  saves the prior name to `historical_name` (so users can still recognize
  records by their old field-trip names), sets `camino_facility_id`, and
  updates `recertified_date` + `spcc_plans.pe_stamp_date` (berm 1) where
  the source spreadsheet has a value.

  Source CSV:
    DropFolder/SPCC/2025 SPCC Plan Updates/facilities_export_matched.csv
    150 rows

  Idempotent:
   - Column adds are IF NOT EXISTS.
   - Match key is UPPER(TRIM(name)) against the CSV's current name. After
     the first run a facility is renamed to the matched name and won't
     match again, so re-runs are safe no-ops for already-imported rows.
   - `historical_name` uses COALESCE so we never overwrite a prior value.
   - PE stamp + recertified dates ARE overwritten when the CSV provides
     them (per spec: "very importantly we need to update the PE stamp
     date with what's on this spreadsheet as well as the recertified date").
*/

-- 1. Schema: add the two columns we need.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS camino_facility_id text;
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS historical_name text;

CREATE INDEX IF NOT EXISTS idx_facilities_camino_facility_id
  ON public.facilities (camino_facility_id);

COMMENT ON COLUMN public.facilities.camino_facility_id IS
  'Camino oilfield-management-system identifier (e.g. OC20180067). Stable across renames; preferred match key for bulk operations like SPCC PDF batch uploads.';
COMMENT ON COLUMN public.facilities.historical_name IS
  'Prior facility name preserved when the user / a data import renames the row. Display-only — toggleable column in FacilitiesManager.';

-- 2. Inline import data.
CREATE TEMP TABLE _camino_import (
  current_name      text,
  matched_name      text,
  camino_id         text,
  pe_stamp_date     date,
  recertified_date  date
) ON COMMIT DROP;

INSERT INTO _camino_import VALUES
  ('MONTY', 'Monty 1XH', 'OC20150095', NULL, NULL),
  ('JACK DAVID/JAXON', 'Jaxon 1XH | Jack David 1XH | Kimber 1MHR | Holden 1WH', 'OC20180067', '2018-12-04'::date, '2025-01-22'::date),
  ('GEORGE', 'George 1H', 'OC20110048', NULL, NULL),
  ('DANSIL', 'Dansil 10XH', 'OC20180038', NULL, NULL),
  ('BIG AL', 'Big Al 1H', 'OC20110009', NULL, NULL),
  ('ADAMS EAST', 'Adams 1XH, 2XH, 5MXH', 'OC20190003', NULL, NULL),
  ('ABEL', 'Abel 1XH', 'OC20180001', NULL, NULL),
  ('(LAT LONG NEEDED) WAMPLER', 'Wampler 1', 'OC20120008', NULL, NULL),
  ('ROWDY LUCY', 'Rowdy Lucy 1XH', 'OC20180112', NULL, NULL),
  ('RAFTER J RANCH', 'Rafter Ranch 1MH', 'OC20170105', NULL, NULL),
  ('PICKARD', 'Pickard 1H', 'OC20180102', '2026-01-04'::date, '2026-01-04'::date),
  ('MCCOMAS', 'McComas 1H', 'OC20180091', '2026-01-04'::date, '2026-01-04'::date),
  ('KOERNER TRUST', 'Koerner Trust 1H', 'OC20110080', NULL, NULL),
  ('HARTLEY', 'Hartley 6XH, 1HX', 'OC20160057', NULL, NULL),
  ('BRAUM FAMILY', 'Braum Family 1HX, 2HX, 3HX', 'OC20180018', NULL, NULL),
  ('BLACK FOREST', 'Black Forest 1XH', 'OC20150010', NULL, NULL),
  ('YIPPI KI-YAY / OORAH 0805 PRODUCTION FACILITY', 'Yippi Ki-Yay 1MH, 2WXH, 3WXH, 4MXH, 5WXH | Oorah 1WH', 'OC20180147', '2023-02-02'::date, NULL),
  ('BLACK KETTLE 1207 PRODUCTION FACILITY', 'Black Kettle 1WXH, 2MXH, 3MXH, 4WXH, 5MXH', 'OC20220011', '2022-12-22'::date, '2022-12-22'::date),
  ('WILL ROGERS 4/CHUCK NORRIS 5', 'Will Rogers 4MXH, Chuck Norris 5MXH', 'OC20250140', NULL, NULL),
  ('WILL ROGERS 2/3', 'Will Rogers 2WXH, 3MXH', 'OC20250141', NULL, NULL),
  ('WATCH THIS 4/5', 'Watch This 4WXH, 5MXH | HMB 4MXH, 5MXH', 'OC20250060', NULL, NULL),
  ('VINITA 1, 2, 3', 'Vinita 1MXH, 2WXH, 3MXH | Johnston 2MXH, 3MXH', 'OC20180076', '2024-08-01'::date, '2025-03-01'::date),
  ('TYLER 4/5', 'Tyler 4MXH, 5WXH |Michael 1WH', 'OC20180092', '2025-03-09'::date, '2025-03-09'::date),
  ('TYLER 1/2', 'Roberts 1MXH |Tyler 1XH, 1UXH, 2MXH', 'OC20170109', '2023-02-02'::date, NULL),
  ('SANDBASS 2/3/4/5', 'Sandbass 2WXH, 3MXH, 4WXH, 5MXH | Payne 2WXH, 3MXH, 4WXH', 'OC20250114', NULL, NULL),
  ('JOHNSTON 4, 5 | VINITA 4, 5 (WEST)', 'Cannonball 1WH, 2MH | Johnston 4WXH, 5MXH | Vinita 4MXH, 5MXH (WEST)', 'OC20170022', '2024-08-14'::date, '2025-03-01'::date),
  ('HMB 4/5', 'Watch This 4WXH, 5MXH | HMB 4MXH, 5MXH', 'OC20250060', NULL, NULL),
  ('HMB 2/3 & WATCH THIS 3', 'HMB 2WXH, 3MXH | Watch This 3MXH', 'OC20250061', NULL, NULL),
  ('GARTH BROOKS 2/3/4', 'Garth Brooks 2MXH, 3MXH, 4WXH', 'OC20250047', NULL, NULL),
  ('GARTH BROOKS 2, 3, 4', 'Garth Brooks 2MXH, 3MXH, 4WXH', 'OC20250047', NULL, NULL),
  ('COWABUNGA EAST (2, 3, 4)', 'Cowabunga 2MXH, 3WXH, 4MXH', 'OC20240035', '2024-08-01'::date, NULL),
  ('CLEBURNE 4N7W 7-12X13H', 'Cleburne 13H', 'OC20180031', '2018-12-03'::date, '2025-01-13'::date),
  ('CHUCK NORRIS 2, 3', 'Chuck Norris 2WXH, 3MXH', 'OC20250139', '2026-04-15'::date, NULL),
  ('AMERICAN BISON 2, 3, 5', 'American Bison 2WXH, 3MXH, 5MXH', 'OC20250142', '2026-04-15'::date, '2026-04-15'::date),
  ('ADAMS 24-34 3,4,6 (WEST)', 'Adams 3XH, 4XH, 6MXH', 'OC20190004', '2025-06-03'::date, '2025-06-03'::date),
  ('BROKEN BOW LAKE 1208 4, 5, 6 (EAST)', 'Sayonara 2MH |Broken Bow 4MXH, 5WXH, 6MXH (EAST)', 'OC20170116', '2024-08-14'::date, '2024-08-14'::date),
  ('CATTLEMANS 1207 32-5 2 3', 'Cattlemans 2WXHR, 3MXH', 'OC20220026', '2023-03-31'::date, '2023-03-31'::date),
  ('TOM HORN 3-7', 'Tom Horn 3H', 'OC20100125', '2017-05-12'::date, '2025-01-13'::date),
  ('WOODHOUSE 7-1H', 'Woodhouse 1H', 'OC20190146', '2019-08-28'::date, '2025-01-13'::date),
  ('WITT 0506 3-10 1 WH', 'Witt 1WH', 'OC20190145', '2020-02-07'::date, '2025-02-01'::date),
  ('WILL ROGERS 1007 22-15-1MH', 'Will Rogers 1MH', 'OC20190144', '2019-09-12'::date, '2025-01-22'::date),
  ('WHEELOCK 1106 33-1MH', 'Wheelock 1MH', 'OC20220143', '2023-08-25'::date, '2023-08-25'::date),
  ('WAYMAN TISDALE 0907 12-13-1MX', 'Wayman Tisdale 1MXH', 'OC20190142', '2025-03-09'::date, '2025-03-09'::date),
  ('WATERMELON 0906 16-21 1MXH', 'Watermelon 1MXH', 'OC20200141', '2021-04-30'::date, NULL),
  ('VINCE GILL 1108-3-10-15 2WXH & 3MXH', 'Vince Gill 2MXH, 3MXH', 'OC20250137', '2025-08-11'::date, NULL),
  ('VINCE GILL 1108 3-10-15-4WXH & 5MXH', 'Vince Gill 4WXH, 5MXH', 'OC20250138', '2025-08-17'::date, NULL),
  ('TYLER 3/GRANT 1UXH', 'Tyler 3WXH', 'OC20250135', '2026-02-19'::date, NULL),
  ('TRUMAN 28-6-6-3H', 'Truman 3H', 'OC20160131', '2025-01-13'::date, '2025-01-13'::date),
  ('TRUMAN 28-6-6-1H', 'Truman 1H', 'OC20150130', '2025-01-14'::date, '2025-01-14'::date),
  ('TRUMAN 28-6-6 4H & 5H', 'Truman 4H, 5H', 'OC20180132', '2025-05-27'::date, '2025-05-27'::date),
  ('TROY AIKMAN  1007 30-19-1MH', 'Troy Aikman 1MH', 'OC20190129', '2020-05-28'::date, '2025-05-25'::date),
  ('TOM HORN 9H/10H/11H', 'Tom Horn  9H, 10H, 11H', 'OC20130128', NULL, NULL),
  ('TOM HORN 6H/7H/8H', 'Tom Horn  6H, 7H, 8H', 'OC20130127', NULL, NULL),
  ('TOM HORN 4H/5H', 'Tom Horn 4H, 5H', 'OC20130126', NULL, NULL),
  ('TOBY KEITH 1108 7-18-1MXH', 'Toby Keith 1MXH, 2MXH | Tenkiller 4WXH', 'OC20220124', '2022-11-08'::date, '2022-11-08'::date),
  ('THURSTON 1-5-6-1H', 'Thurston 1H', 'OC20150123', '2025-06-03'::date, '2025-06-03'::date),
  ('TENKILLER LAKE 1108 31-6-1MXH', 'Tenkiller Lake 1MXH', 'OC20210122', '2021-11-10'::date, NULL),
  ('SPIRO MOUNDS 1006 3-10-2MXH, 3MXH, 4WXH', 'Spiro Mounds 2MXH, 3MXH, 4WXH', 'OC20260001', NULL, NULL),
  ('SPIRO MOUNDS 1006 3-10-1MXH', 'Spiro Mounds 1MXH', 'OC20220121', '2023-08-25'::date, '2023-08-25'::date),
  ('Sooners 1412 29-32-1MXH', 'Sooners 1MXH', 'OC20230120', '2024-08-01'::date, '2024-03-01'::date),
  ('SHELBY 0506 1-12-13-1MXHR, 2WXH', 'Shelby 1MXHR, 2WXH', 'OC20250119', NULL, NULL),
  ('SCOTT 33-6-6 1H (SCOTT 1)', 'Scott 1H', 'OC20170117', NULL, NULL),
  ('SCOTT 2H/3H', 'Scott 2H, 3H', 'OC20170118', NULL, NULL),
  ('SCOTT 1, 4, 5 | TRUMAN-CARMEN 0606 28-21-1UMXH', 'Truman-Carmen 1UMXH | Scott 1UMXH, 4H, 5H', 'OC20180133', '2024-08-01'::date, NULL),
  ('SAYONARA 1208 28-2MH', 'Sayonara 2MH | Broken Bow 4MXH, 5WXH, 6MXH', 'OC20170116', '2024-08-14'::date, '2024-08-14'::date),
  ('SANDRA JEAN 1-34H', 'Sandra Jean 1H', 'OC20120115', '2018-06-26'::date, '2025-01-13'::date),
  ('SANDBASS 0806 4-33 1MH | PAYNE 0806 4-9-1MH', 'Sandbass 1MH | Payne 1MXH', 'OC20190100', '2019-12-31'::date, '2025-01-13'::date),
  ('SAM NOBLE 0907 2-11 1MXH', 'Sam Noble 1MXH', 'OC20200113', '2020-06-25'::date, '2025-06-20'::date),
  ('ROSA OKLAHOMA 0506 4-9 1WH', 'Rosa Oklahoma 1WH', 'OC20210111', '2021-06-09'::date, NULL),
  ('ROMAN NOSE 1007 34-3 1MXH', 'Roman Nose 1MXH', 'OC20200110', '2020-10-26'::date, '2025-09-29'::date),
  ('ROBERTS 0607 12-1-1MXH / TYLER 13-24-1XH PRODUCTION FACILITY', 'Roberts 1MXH | Tyler 1XH, 1UXH, 2MXH', 'OC20170109', '2023-02-02'::date, NULL),
  ('ROBERT KALSU 0806 23-14-1MXH / CLARA LUPER 0806 23-26-1WXH', 'Robert Kalsu 1MXH | Clara Luper 1MXH', 'OC20220030', '2022-11-08'::date, '2022-11-08'::date),
  ('RHONDA 0807 33-4-1MH', 'Rhonda 1MXH', 'OC20220108', '2023-08-25'::date, '2023-08-25'::date),
  ('RED RIVER 1208 24-13-1MXH/2WXH/3MXH', 'Red River 1MXH, 2WXH, 3MXH', 'OC20210107', '2021-11-10'::date, '2021-11-10'::date),
  ('REBA MCENTIRE 1006 29-32 1MXH', 'Reba McEntire 1MXH', 'OC20210106', '2021-02-15'::date, '2025-10-01'::date),
  ('QUARTZ MOUNTAIN 0805 4-9-1WXH', 'Quartz Mountain 1WXH', 'OC20230104', '2024-10-22'::date, '2024-03-01'::date),
  ('QUANAH PARKER 1107 18-7-1WXH', 'Quanah Parker 1WXH', 'OC20190103', '2019-12-31'::date, '2025-03-01'::date),
  ('Price Tower 1009 12-13-1WXH | Honey Creek 1008 7-18-1MXH', 'Honey Creek 1MXH | Price Tower 1WXH', 'OC20230064', '2024-08-01'::date, NULL),
  ('PHILLIPS 5-4-6 #1H', 'Phillips 1H', 'OC20140101', NULL, NULL),
  ('PAXTON 1-20H', 'Paxton 1H', 'OC20170099', '2017-12-12'::date, '2025-01-22'::date),
  ('PAUL HARVEY 1108 10-15 1MXH / VINCE GILL 1108 10-3 1MXH', 'Paul Harvey 1MXH | Vince Gill 1MXH', 'OC20200098', '2020-09-30'::date, '2025-09-29'::date),
  ('MOUNT SCOTT 1207 4-9-4WXH I MOUNT SCOTT 1207 4-9-5MXH (WEST)', 'Mount Scott 4WXH, 5MXH (WEST)', 'OC20240097', '2024-10-22'::date, NULL),
  ('MOUNT SCOTT 1207 4-9-2MXH', 'Mount Scott 2MXH, 3MXH', 'OC20240096', '2024-08-01'::date, NULL),
  ('MOUNT SCOTT 1207 4-9 1MH / COWABUNGA 1207 3-10 1MXH', 'Mount Scott  1WXH | Cowabunga 1MXH', 'OC20200037', '2020-10-26'::date, '2025-09-29'::date),
  ('MICKEY MANTLE 1008 13-12 1WXH', 'Mickey Mantle 1WXH', 'OC20210093', '2022-11-08'::date, '2022-11-08'::date),
  ('Mickey Mantle 1008 12-13 2 MXH, 3MXH, 4WXH', 'Mickey Mantle 2MXH, 3MXH, 4WXH', 'OC20240094', '2025-02-26'::date, '2025-03-01'::date),
  ('MARK PRICE 1007 7-18 4 MXH | 5 WXH (EAST)', 'Mark Price 4MXH, 5WXH', 'OC20240089', '2025-03-06'::date, '2025-03-01'::date),
  ('MARK PRICE 1007 7-18 1WH | 2MXH | 3WXH (WEST)', 'Mark Price 1WH, 2MXH, 3WXH (WEST)', 'OC20200088', '2025-03-06'::date, '2025-03-01'::date),
  ('LYNDA 26-23-1XH', 'Lynda 1XH', 'OC20170086', '2018-03-12'::date, '2025-03-01'::date),
  ('Little Sahara 1107 26-23-4MXH | Little Sahara 1107 26-23-6MXH (EAST)', 'Little Sahara  4MXHR, 6MXH (EAST)', 'OC20220083', '2023-08-25'::date, '2023-08-25'::date),
  ('Little Sahara 1107 26-23-2MXH | Little Sahara 1107 26-23-3WXH (WEST)', 'Little Sahara  2MXH, 3WXH (WEST)', 'OC20220084', '2023-08-25'::date, '2023-08-25'::date),
  ('LITTLE SAHARA 1107 23-26 1MXH / TURNER FALLS 1107 23-14 1MXH', 'Little Sahara 1MXH | Turner Falls 1MXH', 'OC20200085', '2021-04-30'::date, NULL),
  ('LAUREN 0607 10-3-1MXH / WAGNER 0607 15-22-1WXH', 'Lauren 1MXH | Wagner 1WXH', 'OC20230082', '2024-10-22'::date, NULL),
  ('LANE 13-24-1XH', 'Lane 1XH', 'OC20160081', '2019-09-11'::date, '2025-01-13'::date),
  ('JUDAH 0807 17-20-1WH', 'Judah 1WH', 'OC20190079', '2019-08-28'::date, '2025-01-13'::date),
  ('JON SNOW 0505 16-9 1WH', 'Jon Snow 1WH', 'OC20200078', '2020-06-25'::date, '2025-06-20'::date),
  ('JOHNSTON 31-12-7 1H', 'Garth Brooks 1MXH | Johnston 1H', 'OC20170075', '2019-09-12'::date, '2025-01-22'::date),
  ('JOHNSTON 1207 30-31-2MXH | JOHNSTON 1207 30-31-3MXH (EAST)', 'Vinita 1MXH, 2WXH, 3MXH | Johnston 2MXH, 3MXH (EAST)', 'OC20180076', '2024-08-01'::date, '2025-03-01'::date),
  ('JOHN PHILLIPS 0905 31-6 1MXH & ROBBERS CAVE 0905 31-30 1WX', 'John Phillips 1MXH | Robbers Cave 1WXH', 'OC20190074', '2020-02-07'::date, '2025-02-01'::date),
  ('JOHN KEELING 0607 23-14 1WXH, JOYCE KEELING 0606 23-26 1WXH', 'Joyce Keeling 1WXH | John Keeling 1MXHR', 'OC20220073', '2022-11-08'::date, '2022-11-08'::date),
  ('JAXON 8-5-1XH | JACK DAVID 9-4-1XH | KIMBER 0707 17-20 1MH | HOLDEN 0707 16-21 1WH', 'Jaxon 1XH | Jack David 1XH | Kimber 1MHR | Holden 1WH', 'OC20180067', '2018-12-04'::date, '2025-01-22'::date),
  ('JAMES ROSS 1108 2-11-14-4MXH | JAMES ROSS 1108 2-11-14-5WXH', 'James Ross 4MXH, 5WXH', 'OC20250071', '2025-08-25'::date, NULL),
  ('JAMES ROSS 1108 2-11-14-4MXH | JAMES ROSS 1108 2-11-14-5WXH', 'James Ross 4MXH, 5WXH', 'OC20250071', '2025-08-25'::date, NULL),
  ('JAMES ROSS 1108 11-2-1MXH / JOHNNY BENCH 1108 11-14-1MXH', 'James Ross 1MXH | Johnny Bench 1MXH', 'OC20190072', '2020-06-25'::date, '2025-06-20'::date),
  ('JAMES GARNER 0905 36-25-1MH', 'James Garner 1WH', 'OC20190069', '2019-09-12'::date, '2025-01-22'::date),
  ('JACK SWAGGER 0606 29-1WHRS', 'Jack Swagger 1WHRS', 'OC20190068', '2019-12-31'::date, '2025-03-01'::date),
  ('HUNT 27-12-7 1H', 'Hunt 1H', 'OC20160065', NULL, NULL),
  ('HUNT 1207 27-22-2, 3, 4, 5, 6MXH (EAST)', 'Hunt 2MXH, 3WXH, 4MXH, 5WXH, 6MXH (EAST)', 'OC20220066', '2022-11-23'::date, '2022-11-23'::date),
  ('HMB 1108 12-1-1MH | WATCH THIS 1208 36-1WH | WATCH THIS 1205 36-25 2MXH', 'Watch This 1WH, 2MXH | HMB 1MH', 'OC20190062', '2025-03-09'::date, '2025-03-09'::date),
  ('HICKMAN 1109 10-15-1MXH', 'Hickman 1MXH', 'OC20230059', '2023-08-25'::date, '2023-08-25'::date),
  ('HASTA 1206 23-1MH & LA VISTA 1206 26-1WH', 'Hasta 1MH | La Vista 1WH', 'OC20180058', '2018-06-26'::date, '2025-03-01'::date),
  ('GUTHRIE 1207 6-7 1MXH/2WXK/3MXH', 'Guthrie 1MXH, 2WXH, 3MXH', 'OC20200056', '2021-04-30'::date, NULL),
  ('Greenleaf 0707 27-34-3 1 MXH | Ralph Ellison 0707 27-22 1 WXHR', 'Ralph Ellison 1WXHR | Greenleaf 1MXH', 'OC20240055', '2025-03-09'::date, '2025-03-09'::date),
  ('Great Plains 0505 4-9-2WXH | Great Plains 0505 4-9-3MXH | Great Plains 0505 4-9-4WXH', 'Great Plains 2WXH, 3MXH, 4WXH', 'OC20240054', '2024-10-22'::date, NULL),
  ('GRANT 2WXH, 2UXH, 3WXH, 4MXH', 'Grant  2WXH, 2UXH, 3WXH, 4MXH', 'OC20260003', NULL, NULL),
  ('GRANT 0607 25-24-1WH', 'Grant 1WH', 'OC20190053', '2025-03-09'::date, '2025-03-09'::date),
  ('Gourley 1-16H', 'Gourley 1H', 'OC20160052', '2025-08-01'::date, '2025-03-01'::date),
  ('Golden Driller 0707 25-24-1WXH | Golden Driller 0707 25-24-2UMXH | Shockey 0707 36-1-2UMXH | Shockey 36-1-1 XH', 'Golden Driller 1WXH, 2UMXH | Shockey 1 XH, 2UMXH', 'OC20160051', '2024-08-01'::date, NULL),
  ('GERONIMO 1207 6-4WH/5MH', 'Geronimo 4WH, 5MH', 'OC20200050', '2021-04-30'::date, NULL),
  ('GERONIMO 1207 6-2MH', 'Geronimo 2MH', 'OC20170049', '2018-06-26'::date, '2025-01-13'::date),
  ('GARTH BROOKS 1107 6-7-1MXH', 'Garth Brooks 1MXH | Johnston 1H', 'OC20170075', '2019-09-12'::date, '2025-01-22'::date),
  ('GARRARD 0805 2-1XXHW', 'Garrard 1XXHW', 'OC20170045', '2018-06-26'::date, '2025-01-13'::date),
  ('FNA 1207 26-23-1WXH & JIM THORPE 1207 24-25-1MH', 'FNA 1WXH | Jim Thorpe 1WXH', 'OC20180044', '2019-03-22'::date, '2025-01-22'::date),
  ('FLYCATCHER 1107 13-12 1MXH', 'Flycatcher 1MXH', 'OC20200043', '2021-06-09'::date, NULL),
  ('FIDDLE 1207 34-3-1WXH', 'Fiddle 1WXH', 'OC20180042', '2018-12-04'::date, '2025-01-22'::date),
  ('EDDIE SUTTON 1108 9-16-4WXH | EDDIE SUTTON 1108 9-16-5MXH (WEST)', 'Eddie Sutton 4WXH, 5MXH (WEST)', 'OC20230041', '2024-08-01'::date, NULL),
  ('Eddie Sutton 1108 9-16-1MXH | Eddie Sutton 1108 9-16-2WXH | Eddie Sutton 1108 9-16-3MXH (EAST)', 'Eddie Sutton 1MXH, 2WXH, 3MXH (EAST)', 'OC20230040', '2024-08-01'::date, '2024-03-01'::date),
  ('DEER CREEK 1209 36-1-1MXH', 'Deer Creek 1MXH', 'OC20210039', '2022-11-08'::date, '2022-11-08'::date),
  ('COWBOYS 0707 26-35-1WXH | POKES 0707 26-23-1MXH', 'Cowboys 1WXH | Pokes 1MXH', 'OC20230036', '2024-08-01'::date, '2024-03-01'::date),
  ('CORA MAE 0506 10-15-1MH', 'Cora Mae 1MH', 'OC20190034', '2020-02-07'::date, '2025-02-01'::date),
  ('COOK 13-5-6 1H', 'Cook 1H', 'OC20140033', '2019-09-10'::date, '2025-03-01'::date),
  ('COMMERCE COMET 0707 2-11-1WH | RUNESTONE 0707 14-11-1MXH', 'Runestone 1MXH | Commerce Comet 1WH', 'OC20190032', '2025-05-27'::date, '2025-05-27'::date),
  ('CHUCK NORRIS 1007 10-15 1MXH', 'Chuck Norris 1MXH', 'OC20190029', '2025-05-27'::date, '2025-05-27'::date),
  ('CHARLES COE 1108 13-1MH', 'Charles Coe 1MH', 'OC20190028', '2019-06-04'::date, '2025-01-22'::date),
  ('CATTLEMANS 1107 5-32-1MH | SCISSORTAIL 1107 5-8-1MH', 'Cattlemans 1MH | Scissortail 1MH', 'OC20190025', '2019-06-04'::date, '2025-01-22'::date),
  ('CATTLEMANS 1107 5-32 4 5 6 7', 'Cattlemans 4WXH, 5MXH, 6WXH, 7MXH', 'OC20220027', '2023-03-31'::date, '2023-03-31'::date),
  ('CAROLINE 1007 31-6-1MXH & REDBUD -1007 25-1WH', 'Caroline 1MXH | Redbud 1WH', 'OC20180024', '2025-03-09'::date, '2025-03-09'::date),
  ('CARMEN 21-6-6 1H', 'Carmen 1H', 'OC20170023', '2025-03-09'::date, '2025-03-09'::date),
  ('BYERS 0806 10-3-1MH & UNCOMPAHGRE 10-15-1MH', 'Uncompahgre 1MH | Byers 1MHR', 'OC20180021', '2018-12-03'::date, '2025-01-22'::date),
  ('BROKEN BOW 1208 1, 2, 3 (WEST)', 'Broken Bow 1MXH, 2WXH, 3MXH', 'OC20210020', '2024-08-01'::date, '2024-08-01'::date),
  ('BRANDON 12-5-6 1H', 'Brandon 1H', 'OC20150017', '2025-03-01'::date, '2025-03-01'::date),
  ('BONZAI 1206 8-1MH', 'Bonzai 1MHR', 'OC20180016', '2018-06-25'::date, '2025-03-01'::date),
  ('BLAZERS 0904 30-19-1WXH', 'Blazers 1WXH', 'OC20220015', '2022-11-08'::date, '2022-11-08'::date),
  ('Black Mesa 0505 3-10-4MXH | Black Mesa 0505 3-10-5WXH', 'Black Mesa  4MXH, 5WXH', 'OC20240012', '2024-10-22'::date, NULL),
  ('Black Mesa 0505 3-10-2MXH | Black Mesa 0505 3-10-3WXH', 'Black Mesa  2MXH, 3WXH', 'OC20240013', '2024-10-22'::date, NULL),
  ('BLACK MESA 0505 3-10 1WH / GREAT PLAINS 0505 4-9 1MH', 'Black Mesa 1WH | Great Plains 1MH', 'OC20200014', '2020-05-28'::date, '2025-05-27'::date),
  ('BAR-K 31-6-6-1H', 'Bar K 1H', 'OC20180007', '2025-05-27'::date, '2025-05-27'::date),
  ('ASH 0807 36-1-1WH', 'Ash 1WH', 'OC20190006', '2019-08-28'::date, '2025-01-14'::date),
  ('AMERICAN BISON 1007 21-28-1MXH/RON HOWARD 1007 21-16-1MXH', 'American Bison 1MXH | Ron Howard 1MXH', 'OC20210005', '2021-11-10'::date, NULL),
  ('ACADIAN 0806 11-2-1MH', 'Acadian 1MH', 'OC20190002', '2019-08-29'::date, '2025-03-01'::date);

-- 3. Resolve each CSV row to a facility id (case-insensitive name match).
--    Rows that don't resolve are surfaced via a NOTICE so they show in the
--    migration log without aborting the whole import.
DO $$
DECLARE unmatched_count int;
BEGIN
  SELECT count(*) INTO unmatched_count
  FROM _camino_import i
  WHERE NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE UPPER(TRIM(f.name)) = UPPER(TRIM(i.current_name))
       OR f.camino_facility_id = i.camino_id  -- post-rename re-runs
  );
  IF unmatched_count > 0 THEN
    RAISE NOTICE 'Camino import: % CSV rows could not be matched to any facility (likely already imported or never existed).', unmatched_count;
  END IF;
END $$;

-- 4. Apply renames + camino id + historical name + recertified date.
UPDATE public.facilities f
SET
  historical_name = COALESCE(f.historical_name, f.name),
  name = i.matched_name,
  camino_facility_id = i.camino_id,
  recertified_date = COALESCE(i.recertified_date, f.recertified_date)
FROM _camino_import i
WHERE UPPER(TRIM(f.name)) = UPPER(TRIM(i.current_name))
  AND (f.camino_facility_id IS NULL OR f.camino_facility_id = '');  -- only first-time import

-- 5. Apply PE stamp dates to the berm-1 spcc_plans row for each matched
--    facility. We resolve facility_id via the just-applied camino_facility_id
--    so step 4 and step 5 can run idempotently. The spcc_plans backfill
--    migration created exactly one berm_index=1 row per facility — but we
--    use ON CONFLICT-style guards anyway in case the row was deleted.
UPDATE public.spcc_plans p
SET pe_stamp_date = i.pe_stamp_date
FROM _camino_import i
JOIN public.facilities f ON f.camino_facility_id = i.camino_id
WHERE p.facility_id = f.id
  AND p.berm_index = 1
  AND i.pe_stamp_date IS NOT NULL;

-- 6. Safety net: any facility with a CSV PE date but no berm-1 plan row
--    (shouldn't happen after the prior backfill, but defensive) gets one.
INSERT INTO public.spcc_plans (facility_id, berm_index, pe_stamp_date, assigned_well_indices)
SELECT f.id, 1, i.pe_stamp_date, '{}'::int[]
FROM _camino_import i
JOIN public.facilities f ON f.camino_facility_id = i.camino_id
WHERE i.pe_stamp_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.spcc_plans p
    WHERE p.facility_id = f.id AND p.berm_index = 1
  );
