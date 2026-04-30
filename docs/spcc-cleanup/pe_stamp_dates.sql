-- ============================================================================
-- SPCC PE Stamp Date Cleanup
-- ============================================================================
-- Updates `spcc_plans.pe_stamp_date` for every berm of each listed facility,
-- using the date read from the PE seal page of each Renewal PDF.
--
-- WHAT THIS DOES
--   For each (camino_facility_id, pe_stamp_date) pair below, sets the
--   pe_stamp_date on EVERY spcc_plans row whose facility's
--   camino_facility_id matches. Multi-berm facilities get the same date on
--   every berm — Israel confirmed the file/seal doesn't distinguish berms.
--
-- WHAT THIS DOESN'T DO
--   - Doesn't touch facilities NOT in this list.
--   - Doesn't touch recertified_date on either spcc_plans or facilities
--     (that's a separate cleanup; this only fixes the original PE stamp).
--   - Doesn't update facilities.spcc_pe_stamp_date directly — the existing
--     mirror trigger (`sync_facility_from_spcc_plans`) propagates from
--     spcc_plans → facilities automatically after each row update.
--
-- VERIFY BEFORE RUNNING
--   - Check the duplicate Camino ID warning at the bottom of the report
--     (OC20180067 maps to two different facilities; OC20170075 has two
--     PDFs with different cert dates).
--   - Spot-check 3-5 rows by Camino ID against the PE_STAMP_CLEANUP_REPORT.md
--     summary before running.
--
-- ROLLBACK
--   If you need to revert, see the BEFORE snapshot at the top of the
--   report (run the SELECT below first to capture current state).
--
-- BEFORE: capture current state for any facility we're about to touch.
--   SELECT f.camino_facility_id, p.berm_index, p.pe_stamp_date
--   FROM spcc_plans p
--   JOIN facilities f ON f.id = p.facility_id
--   WHERE f.camino_facility_id IN (
--     -- list pulled from the Camino IDs in the UPDATE block below
--     'OC20190002','OC20190006','OC20180007', /* etc. */
--   )
--   ORDER BY f.camino_facility_id, p.berm_index;

BEGIN;

-- Acadian 1MH (OC20190002) | PE: Randall D. Holleyman | raw: 8/29/19
UPDATE spcc_plans SET pe_stamp_date = '2019-08-29'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190002');

-- Ash 1WH (OC20190006) | PE: Randall D. Holleyman | raw: 8/28/19
UPDATE spcc_plans SET pe_stamp_date = '2019-08-28'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190006');

-- Bar K 1H (OC20180007) | PE: Kurt M. Hibbard | raw: 05/27/2025
UPDATE spcc_plans SET pe_stamp_date = '2025-05-27'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180007');

-- Black Mesa 1WH; Great Plains 1MH (OC20200014) | PE: Billy Wayne Niblar | raw: May 28 2020 | handwritten date
UPDATE spcc_plans SET pe_stamp_date = '2020-05-28'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20200014');

-- Bonzai 1MHR (OC20180016) | PE: Randall D. Holleyman | raw: 6/25/18
UPDATE spcc_plans SET pe_stamp_date = '2018-06-25'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180016');

-- Carmen 1H (OC20170023) | PE: Kurt M. Hibbard | raw: 03/09/2025
UPDATE spcc_plans SET pe_stamp_date = '2025-03-09'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20170023');

-- Caroline 1MXH; Redbud 1WH (OC20180024) | PE: Kurt M. Hibbard | raw: 03/09/2025
UPDATE spcc_plans SET pe_stamp_date = '2025-03-09'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180024');

-- Cattlemans 1MH; Scissortail 1MH (OC20190025) | PE: Randall D. Holleyman | raw: 6/4/19
UPDATE spcc_plans SET pe_stamp_date = '2019-06-04'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190025');

-- Charles Coe 1MH (OC20190028) | PE: Randall D. Holleyman | raw: 6/4/19
UPDATE spcc_plans SET pe_stamp_date = '2019-06-04'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190028');

-- Chuck Norris 1MXH (OC20190029) | PE: Kurt M. Hibbard | raw: 05/27/2025
UPDATE spcc_plans SET pe_stamp_date = '2025-05-27'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190029');

-- Cleburne 13H (OC20180031) | PE: Randall D. Holleyman | raw: 12/3/18
UPDATE spcc_plans SET pe_stamp_date = '2018-12-03'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180031');

-- Cora Mae 1MH (OC20190034) | PE: Randall D. Holleyman | raw: 2/7/20 | cert is on page 2 (B Bastin newer format)
UPDATE spcc_plans SET pe_stamp_date = '2020-02-07'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190034');

-- FNA 1WXH; Jim Thorpe 1WXH (OC20180044) | PE: Randall D. Holleyman | raw: 3/22/19
UPDATE spcc_plans SET pe_stamp_date = '2019-03-22'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180044');

-- Fiddle 1WXH (OC20180042) | PE: Randall D. Holleyman | raw: 12/4/18
UPDATE spcc_plans SET pe_stamp_date = '2018-12-04'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180042');

-- Garrard 1XXHW (OC20170045) | PE: Randall D. Holleyman | raw: 6/26/18
UPDATE spcc_plans SET pe_stamp_date = '2018-06-26'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20170045');

-- Garth Brooks 1MXH; Johnston 1H (filename date 01-14-25) (OC20170075) | PE: Randall D. Holleyman | raw: 11/12/19 | cert page references Johnston 31-12-7 1H specifically
UPDATE spcc_plans SET pe_stamp_date = '2019-11-12'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20170075');

-- Garth Brooks 1MXH; Johnston 1H (filename date 01-22-25) (OC20170075) | PE: Randall D. Holleyman | raw: 9/12/19 | cert page references Garth Brooks 1107 6-7-1MXH (different facility than 018 despite same Camino ID)
UPDATE spcc_plans SET pe_stamp_date = '2019-09-12'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20170075');

-- Geronimo 2MH (OC20170049) | PE: Randall D. Holleyman | raw: 6/26/18
UPDATE spcc_plans SET pe_stamp_date = '2018-06-26'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20170049');

-- Grant 1UXH (OC20250135) | PE: Kurt M. Hibbard | raw: 03/09/2025
UPDATE spcc_plans SET pe_stamp_date = '2025-03-09'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20250135');

-- Hasta 1MH; La Vista 1WH (OC20180058) | PE: Randall D. Holleyman | raw: 6/26/18
UPDATE spcc_plans SET pe_stamp_date = '2018-06-26'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180058');

-- Jack Swagger 1WHRS (OC20190068) | PE: Randall D. Holleyman | raw: 12/31/19
UPDATE spcc_plans SET pe_stamp_date = '2019-12-31'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190068');

-- James Garner 1WH (OC20190069) | PE: Randall D. Holleyman | raw: 9/12/19
UPDATE spcc_plans SET pe_stamp_date = '2019-09-12'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190069');

-- James Ross 1MXH; Johnny Bench 1MXH (OC20190072) | PE: Billy Wayne Niblar | raw: 6-25-2020 | handwritten
UPDATE spcc_plans SET pe_stamp_date = '2020-06-25'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190072');

-- Jaxon 1XH; Jack David 1XH (OC20180067) | PE: Randall D. Holleyman | raw: 12/4/18 | cert references Jack David 0-4-1XH & Jaxon 8-5-1XH; SAME camino_id as Kimber (030)
UPDATE spcc_plans SET pe_stamp_date = '2018-12-04'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180067');

-- John Phillips 1MXH; Robbers Cave 1WXH (OC20190074) | PE: Randall D. Holleyman | raw: 2/7/20 | B Bastin format, cert on page 2
UPDATE spcc_plans SET pe_stamp_date = '2020-02-07'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190074');

-- Jon Snow 1WH (OC20200078) | PE: Billy Wayne Niblar | raw: 6-25-2020 | handwritten
UPDATE spcc_plans SET pe_stamp_date = '2020-06-25'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20200078');

-- Judah 1WH (OC20190079) | PE: Randall D. Holleyman | raw: 8/28/19
UPDATE spcc_plans SET pe_stamp_date = '2019-08-28'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190079');

-- Kimber 1MHR; Holden 1WH (OC20180067) | PE: Billy Wayne Niblar | raw: May 28 2020 | handwritten; SAME camino_id as Jaxon (026) — DUPLICATE Camino ID across two facilities
UPDATE spcc_plans SET pe_stamp_date = '2020-05-28'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180067');

-- Mount Scott 1WXH; Cowabunga 1MXH (OC20200037) | PE: Billy Wayne Niblar | raw: 10-26-20 | handwritten
UPDATE spcc_plans SET pe_stamp_date = '2020-10-26'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20200037');

-- Paul Harvey 1MXH; Vince Gill 1MXH (OC20200098) | PE: Billy Wayne Niblar | raw: 9-30-20 | handwritten
UPDATE spcc_plans SET pe_stamp_date = '2020-09-30'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20200098');

-- Paxton 1H (OC20170099) | PE: Randall D. Holleyman | raw: 12/12/17 | cert prepared for Cimarex Energy Co. (pre-Camino)
UPDATE spcc_plans SET pe_stamp_date = '2017-12-12'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20170099');

-- Quanah Parker 1WXH (OC20190103) | PE: Randall D. Holleyman | raw: 12/31/19
UPDATE spcc_plans SET pe_stamp_date = '2019-12-31'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190103');

-- Reba McEntire 1MXH (OC20210106) | PE: Billy Wayne Niblar | raw: 2-15-2022 | handwritten; could be 2-13 or 2-15
UPDATE spcc_plans SET pe_stamp_date = '2022-02-15'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20210106');

-- Roman Nose 1MXH (OC20200110) | PE: Billy Wayne Niblar | raw: 8-26-2020 | handwritten
UPDATE spcc_plans SET pe_stamp_date = '2020-08-26'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20200110');

-- Runestone 1MXH; Commerce Comet 1WH (OC20190032) | PE: Kurt M. Hibbard | raw: 05/27/2025
UPDATE spcc_plans SET pe_stamp_date = '2025-05-27'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190032');

-- Sam Noble 1MXH (OC20200113) | PE: Billy Wayne Niblar | raw: 6-25-2020 | handwritten
UPDATE spcc_plans SET pe_stamp_date = '2020-06-25'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20200113');

-- Sandbass 1MH; Payne 1MXH (OC20190100) | PE: Randall D. Holleyman | raw: 12/31/19
UPDATE spcc_plans SET pe_stamp_date = '2019-12-31'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190100');

-- Sandra Jean 1H (OC20120115) | PE: Randall D. Holleyman | raw: 6/26/18 | older Holleyman reg# 13099 (not 13999)
UPDATE spcc_plans SET pe_stamp_date = '2018-06-26'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20120115');

-- Tom Horn 3H (OC20100125) | PE: Derek T. Blackshare | raw: 5.12.17 | cert is on page 2; small 5-page Rebellion Energy plan
UPDATE spcc_plans SET pe_stamp_date = '2017-05-12'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20100125');

-- Troy Aikman 1MH (OC20190129) | PE: Billy Wayne Niblar | raw: May 28 2020 | handwritten; cert references Troy Aikman 1007 30-19 1MH
UPDATE spcc_plans SET pe_stamp_date = '2020-05-28'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190129');

-- Truman 4H, 5H (OC20180132) | PE: Kurt M. Hibbard | raw: 05/27/2025 | cert references Truman 28-6-6-4H
UPDATE spcc_plans SET pe_stamp_date = '2025-05-27'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180132');

-- Tyler 4MXH, 5WXH; Michael 1WH (OC20180092) | PE: Kurt M. Hibbard | raw: 03/09/2025 | cert references Michael 0607 11-2-1WH
UPDATE spcc_plans SET pe_stamp_date = '2025-03-09'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180092');

-- Uncompahgre 1MH; Byers 1MHR (OC20180021) | PE: Randall D. Holleyman | raw: 12/3/18 | WARNING: cert page references "Abel 25-30 1XH" facility, NOT Uncompahgre/Byers — wrong cert page bound to PDF or filename mismatch
UPDATE spcc_plans SET pe_stamp_date = '2018-12-03'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20180021');

-- Watch This 1WH, 2MXH; HMB 1MH (OC20190062) | PE: Kurt M. Hibbard | raw: 03/09/2025 | cert references HMB 1208 12-1-1MH & Watch This 1208 36-13H
UPDATE spcc_plans SET pe_stamp_date = '2025-03-09'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190062');

-- Wayman Tisdale 1MXH (OC20190142) | PE: Kurt M. Hibbard | raw: 03/09/2025 | cert references Wayman Tisdale 0907 12-13-1MX
UPDATE spcc_plans SET pe_stamp_date = '2025-03-09'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190142');

-- Will Rogers 1MH (OC20190144) | PE: Randall D. Holleyman | raw: 9/12/19 | cert references Will Rogers 1007 22-15-1MH
UPDATE spcc_plans SET pe_stamp_date = '2019-09-12'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190144');

-- Witt 1WH (OC20190145) | PE: Randall D. Holleyman | raw: 2/7/20 | B Bastin format, cert on page 2
UPDATE spcc_plans SET pe_stamp_date = '2020-02-07'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190145');

-- Woodhouse 1H (OC20190146) | PE: Randall D. Holleyman | raw: 8/28/19 | cert references Woodhouse 7-1-H
UPDATE spcc_plans SET pe_stamp_date = '2019-08-28'::date
  WHERE facility_id IN (SELECT id FROM facilities WHERE camino_facility_id = 'OC20190146');

-- AFTER: re-check the same rows match what you expect.
--   SELECT f.camino_facility_id, f.name, p.berm_index, p.pe_stamp_date
--   FROM spcc_plans p
--   JOIN facilities f ON f.id = p.facility_id
--   WHERE f.camino_facility_id IN (
--     'OC20190002','OC20190006','OC20180007', /* etc. */
--   )
--   ORDER BY f.camino_facility_id, p.berm_index;

COMMIT;
-- ============================================================================
