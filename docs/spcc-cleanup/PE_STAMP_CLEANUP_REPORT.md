# SPCC PE Stamp Date Cleanup — Report

Read PE seal page from each of the 54 "SPCC Renewal" PDFs in
`/Users/soundship/Library/CloudStorage/OneDrive-BEAR/Projects/Camino/DropFolder/SPCC/2025 SPCC Plan Updates/All SPCC Plans`
and extracted the PE stamp date.

## Summary

| | Count |
|---|---|
| PDFs reviewed | 54 |
| Dates successfully read | 48 |
| Dates blank / unreadable | 6 |

The 6 blank dates are all "Red Wolf Natural Resources" template PDFs
signed by **William Torneten (OK 14791)**. The Date field on every one
was left blank — the PE relied on a digital-signature annotation that
was flattened into a static image when the PDFs were re-printed via
"Microsoft: Print To PDF". The original sig timestamp is no longer
recoverable from the file. These need a manual decision (see "Needs
manual handling" below).

## Engineers seen

| PE | Reg # | Plans |
|---|---|---|
| Randall D. Holleyman | OK 13999 (older 13099) | 28 |
| Kurt M. Hibbard | OK 27683 | 11 |
| Billy Wayne Niblar | OK 16495 | 9 |
| William Torneten | OK 14791 | 6 (all blank dates) |
| Derek T. Blackshare | OK 17181 | 1 (Tom Horn) |

## Filename anomalies worth your attention

1. **Garth Brooks 1MXH; Johnston 1H — OC20170075** appears TWICE in the
   folder with different filename dates and different cert-page contents:
   - `... SPCC Renewal (01-14-25).pdf` → cert is for **Johnston 31-12-7 1H** (PE date 11/12/19)
   - `... SPCC Renewal (01-22-25).pdf` → cert is for **Garth Brooks 1107 6-7-1MXH** (PE date 9/12/19)

   The SQL update will hit OC20170075 twice — the LAST one in execution
   order wins (9/12/19). If those should be different facility rows, the
   Camino ID is currently a duplicate and the data model can't tell
   them apart. **Decide which date you want kept** before running.

2. **OC20180067** is shared by TWO different facilities in the folder:
   - **Jaxon 1XH; Jack David 1XH** — cert date 12/4/18
   - **Kimber 1MHR; Holden 1WH** — cert date 5/28/20

   Same problem as #1: the SQL `WHERE camino_facility_id = 'OC20180067'`
   will set both rows to whichever date executes last. Almost certainly
   one of these has the wrong Camino ID in your data. **Fix the
   duplicate Camino ID first**, then re-run the relevant update by hand.

3. **Uncompahgre 1MH; Byers 1MHR — OC20180021** — the cert page in the
   PDF is for **Abel 25-30 1XH**, not Uncompahgre/Byers. Either the
   wrong PDF was attached or the original SPCC plan was actually issued
   to Abel and shared with Uncompahgre/Byers later. **Verify before
   accepting** the 12/3/18 date.

4. **Paxton 1H — OC20170099** cert was issued to **Cimarex Energy Co.**
   (12/12/17), not Camino. This is a pre-Camino plan that Camino
   inherited — the date is still the original PE date.

## Needs manual handling

These 6 facilities don't have a readable PE stamp date in the PDF.
They're all William Torneten Red Wolf-template plans where the date
field on the cert page was left blank (the original digital signature
timestamp was flattened away when re-printed).

| Camino ID | Facility | Filename |
|---|---|---|
| OC20150017 | Brandon 1H | Brandon 1H - OC20150017 - SPCC Renewal (03-01-25).pdf |
| OC20140033 | Cook 1H | Cook 1H - OC20140033 - SPCC Renewal (03-01-25).pdf |
| OC20160081 | Lane 1XH | Lane 1XH - OC20160081 - SPCC Renewal (01-13-25).pdf |
| OC20170086 | Lynda 1XH | Lynda 1XH - OC20170086 - SPCC Renewal (03-01-25).pdf |
| OC20150130 | Truman 1H | Truman 1H - OC20150130 - SPCC Renewal (01-14-25).pdf |
| OC20160131 | Truman 3H | Truman 3H - OC20160131 - SPCC Renewal (01-13-25).pdf |

Options for these 6:
- Pull the **original (un-flattened) PDFs** from Red Wolf if available — the digital sig timestamp is recoverable.
- Get the original PE stamp dates from another record (issuance log, contract).
- Leave `pe_stamp_date` blank (NULL) on these until you have a verified date.

## Full extraction table

| # | Camino ID | Facility | PE | Date (raw) | Date (ISO) | Notes |
|---|---|---|---|---|---|---|
| 001 | OC20190002 | Acadian 1MH | Randall D. Holleyman | 8/29/19 | 2019-08-29 |  |
| 002 | OC20190006 | Ash 1WH | Randall D. Holleyman | 8/28/19 | 2019-08-28 |  |
| 003 | OC20180007 | Bar K 1H | Kurt M. Hibbard | 05/27/2025 | 2025-05-27 |  |
| 004 | OC20200014 | Black Mesa 1WH; Great Plains 1MH | Billy Wayne Niblar | May 28 2020 | 2020-05-28 | handwritten date |
| 005 | OC20180016 | Bonzai 1MHR | Randall D. Holleyman | 6/25/18 | 2018-06-25 |  |
| 006 | OC20150017 | Brandon 1H | William Torneten |  |  | DATE OBSCURED by digital-signature overlay; check page 6 or 8 |
| 007 | OC20170023 | Carmen 1H | Kurt M. Hibbard | 03/09/2025 | 2025-03-09 |  |
| 008 | OC20180024 | Caroline 1MXH; Redbud 1WH | Kurt M. Hibbard | 03/09/2025 | 2025-03-09 |  |
| 009 | OC20190025 | Cattlemans 1MH; Scissortail 1MH | Randall D. Holleyman | 6/4/19 | 2019-06-04 |  |
| 010 | OC20190028 | Charles Coe 1MH | Randall D. Holleyman | 6/4/19 | 2019-06-04 |  |
| 011 | OC20190029 | Chuck Norris 1MXH | Kurt M. Hibbard | 05/27/2025 | 2025-05-27 |  |
| 012 | OC20180031 | Cleburne 13H | Randall D. Holleyman | 12/3/18 | 2018-12-03 |  |
| 013 | OC20140033 | Cook 1H | William Torneten |  |  | DATE FIELD BLANK on cert page; PDF was Print-To-PDF flattened so original digital-sig timestamp lost |
| 014 | OC20190034 | Cora Mae 1MH | Randall D. Holleyman | 2/7/20 | 2020-02-07 | cert is on page 2 (B Bastin newer format) |
| 015 | OC20180044 | FNA 1WXH; Jim Thorpe 1WXH | Randall D. Holleyman | 3/22/19 | 2019-03-22 |  |
| 016 | OC20180042 | Fiddle 1WXH | Randall D. Holleyman | 12/4/18 | 2018-12-04 |  |
| 017 | OC20170045 | Garrard 1XXHW | Randall D. Holleyman | 6/26/18 | 2018-06-26 |  |
| 018 | OC20170075 | Garth Brooks 1MXH; Johnston 1H (filename date 01-14-25) | Randall D. Holleyman | 11/12/19 | 2019-11-12 | cert page references Johnston 31-12-7 1H specifically |
| 019 | OC20170075 | Garth Brooks 1MXH; Johnston 1H (filename date 01-22-25) | Randall D. Holleyman | 9/12/19 | 2019-09-12 | cert page references Garth Brooks 1107 6-7-1MXH (different facility than 018 despite same Camino ID) |
| 020 | OC20170049 | Geronimo 2MH | Randall D. Holleyman | 6/26/18 | 2018-06-26 |  |
| 021 | OC20250135 | Grant 1UXH | Kurt M. Hibbard | 03/09/2025 | 2025-03-09 |  |
| 022 | OC20180058 | Hasta 1MH; La Vista 1WH | Randall D. Holleyman | 6/26/18 | 2018-06-26 |  |
| 023 | OC20190068 | Jack Swagger 1WHRS | Randall D. Holleyman | 12/31/19 | 2019-12-31 |  |
| 024 | OC20190069 | James Garner 1WH | Randall D. Holleyman | 9/12/19 | 2019-09-12 |  |
| 025 | OC20190072 | James Ross 1MXH; Johnny Bench 1MXH | Billy Wayne Niblar | 6-25-2020 | 2020-06-25 | handwritten |
| 026 | OC20180067 | Jaxon 1XH; Jack David 1XH | Randall D. Holleyman | 12/4/18 | 2018-12-04 | cert references Jack David 0-4-1XH & Jaxon 8-5-1XH; SAME camino_id as Kimber (030) |
| 027 | OC20190074 | John Phillips 1MXH; Robbers Cave 1WXH | Randall D. Holleyman | 2/7/20 | 2020-02-07 | B Bastin format, cert on page 2 |
| 028 | OC20200078 | Jon Snow 1WH | Billy Wayne Niblar | 6-25-2020 | 2020-06-25 | handwritten |
| 029 | OC20190079 | Judah 1WH | Randall D. Holleyman | 8/28/19 | 2019-08-28 |  |
| 030 | OC20180067 | Kimber 1MHR; Holden 1WH | Billy Wayne Niblar | May 28 2020 | 2020-05-28 | handwritten; SAME camino_id as Jaxon (026) — DUPLICATE Camino ID across two facilities |
| 031 | OC20160081 | Lane 1XH | William Torneten |  |  | DATE FIELD BLANK; Red Wolf format; cert is for Lane 13-24-1XH |
| 032 | OC20170086 | Lynda 1XH | William Torneten |  |  | DATE FIELD BLANK; Red Wolf format; cert is for Lynda 26-23-1XH |
| 033 | OC20200037 | Mount Scott 1WXH; Cowabunga 1MXH | Billy Wayne Niblar | 10-26-20 | 2020-10-26 | handwritten |
| 034 | OC20200098 | Paul Harvey 1MXH; Vince Gill 1MXH | Billy Wayne Niblar | 9-30-20 | 2020-09-30 | handwritten |
| 035 | OC20170099 | Paxton 1H | Randall D. Holleyman | 12/12/17 | 2017-12-12 | cert prepared for Cimarex Energy Co. (pre-Camino) |
| 036 | OC20190103 | Quanah Parker 1WXH | Randall D. Holleyman | 12/31/19 | 2019-12-31 |  |
| 037 | OC20210106 | Reba McEntire 1MXH | Billy Wayne Niblar | 2-15-2022 | 2022-02-15 | handwritten; could be 2-13 or 2-15 |
| 038 | OC20200110 | Roman Nose 1MXH | Billy Wayne Niblar | 8-26-2020 | 2020-08-26 | handwritten |
| 039 | OC20190032 | Runestone 1MXH; Commerce Comet 1WH | Kurt M. Hibbard | 05/27/2025 | 2025-05-27 |  |
| 040 | OC20200113 | Sam Noble 1MXH | Billy Wayne Niblar | 6-25-2020 | 2020-06-25 | handwritten |
| 041 | OC20190100 | Sandbass 1MH; Payne 1MXH | Randall D. Holleyman | 12/31/19 | 2019-12-31 |  |
| 042 | OC20120115 | Sandra Jean 1H | Randall D. Holleyman | 6/26/18 | 2018-06-26 | older Holleyman reg# 13099 (not 13999) |
| 043 | OC20100125 | Tom Horn 3H | Derek T. Blackshare | 5.12.17 | 2017-05-12 | cert is on page 2; small 5-page Rebellion Energy plan |
| 044 | OC20190129 | Troy Aikman 1MH | Billy Wayne Niblar | May 28 2020 | 2020-05-28 | handwritten; cert references Troy Aikman 1007 30-19 1MH |
| 045 | OC20150130 | Truman 1H | William Torneten |  |  | DATE FIELD BLANK; Red Wolf format; Truman 28-6-6-1H |
| 046 | OC20160131 | Truman 3H | William Torneten |  |  | DATE FIELD BLANK; Red Wolf format; Truman 28-6-4-3H |
| 047 | OC20180132 | Truman 4H, 5H | Kurt M. Hibbard | 05/27/2025 | 2025-05-27 | cert references Truman 28-6-6-4H |
| 048 | OC20180092 | Tyler 4MXH, 5WXH; Michael 1WH | Kurt M. Hibbard | 03/09/2025 | 2025-03-09 | cert references Michael 0607 11-2-1WH |
| 049 | OC20180021 | Uncompahgre 1MH; Byers 1MHR | Randall D. Holleyman | 12/3/18 | 2018-12-03 | WARNING: cert page references "Abel 25-30 1XH" facility, NOT Uncompahgre/Byers — wrong cert page bound to PDF or filename mismatch |
| 050 | OC20190062 | Watch This 1WH, 2MXH; HMB 1MH | Kurt M. Hibbard | 03/09/2025 | 2025-03-09 | cert references HMB 1208 12-1-1MH & Watch This 1208 36-13H |
| 051 | OC20190142 | Wayman Tisdale 1MXH | Kurt M. Hibbard | 03/09/2025 | 2025-03-09 | cert references Wayman Tisdale 0907 12-13-1MX |
| 052 | OC20190144 | Will Rogers 1MH | Randall D. Holleyman | 9/12/19 | 2019-09-12 | cert references Will Rogers 1007 22-15-1MH |
| 053 | OC20190145 | Witt 1WH | Randall D. Holleyman | 2/7/20 | 2020-02-07 | B Bastin format, cert on page 2 |
| 054 | OC20190146 | Woodhouse 1H | Randall D. Holleyman | 8/28/19 | 2019-08-28 | cert references Woodhouse 7-1-H |
