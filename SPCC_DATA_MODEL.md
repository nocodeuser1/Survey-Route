# SPCC Data Model Documentation

This document describes how SPCC (Spill Prevention, Control, and Countermeasure) plans and inspections are managed in the Survey-Route application.

## Overview

The system tracks two distinct types of SPCC compliance activities:

| Type | Frequency | Description |
|------|-----------|-------------|
| **SPCC Plans** | Every 5 years | Official SPCC plan documents that must be renewed every 5 years (can be approval of existing plan) |
| **SPCC Inspections** | Yearly | Annual facility inspections to verify SPCC compliance |

## SPCC Plans

### Business Rules

1. **Initial Plan Requirement**: A facility must have an SPCC plan within 6 months of first production date (`first_prod_date`)
2. **Plan Renewal**: Plans must be renewed (recertified) every 5 years from the PE stamp date (`spcc_pe_stamp_date`)
3. **One Plan Per Facility**: Each facility has at most one active SPCC plan at a time
4. **Plan Storage**: Plans are uploaded as PDF files and stored with their PE stamp date

### Database Fields (Facility Table)

| Field | Type | Description |
|-------|------|-------------|
| `spcc_plan_url` | text | URL to the uploaded SPCC plan document |
| `spcc_pe_stamp_date` | date | Professional Engineer stamp date (determines renewal due date) |
| `spcc_due_date` | date | Calculated initial due date (6 months from first prod) |
| `first_prod_date` | date | First production date for the facility |

### Plan Status Logic

The system calculates plan status based on these conditions:

```
if NO spcc_plan_url OR NO spcc_pe_stamp_date:
    if first_prod_date exists:
        due_date = first_prod_date + 6 months
        if today > due_date:
            status = "OVERDUE" (initial plan overdue)
        elif days until due <= 30:
            status = "WARNING" (initial plan due soon)
        else:
            status = "PENDING" (plan needed within 6 months)
    else:
        status = "MISSING" (no plan on file)
else:
    renewal_date = spcc_pe_stamp_date + 5 years
    if today > renewal_date:
        status = "EXPIRED" (plan expired, renewal needed)
    elif days until expiry <= 90:
        status = "EXPIRING" (plan expiring soon)
    else:
        status = "VALID" (plan active)
```

### Filtering Facilities Needing SPCC Plans

A facility needs an SPCC Plan if:
- It has NO plan (`spcc_plan_url` is null), OR
- Its plan is expired (5+ years since `spcc_pe_stamp_date`), OR
- Its plan is expiring soon (within 90 days of expiry)

## SPCC Inspections

### Business Rules

1. **Yearly Requirement**: Facilities require annual SPCC inspections
2. **Multiple Inspections**: Facilities can have multiple historical inspections
3. **Validity Period**: An inspection is valid for 1 year from its completion date
4. **Completion Types**:
   - **Internal**: Inspections conducted using the app's inspection system
   - **External**: Inspections conducted by third parties (marked manually)

### Database Fields (Facility Table)

| Field | Type | Description |
|-------|------|-------------|
| `spcc_completion_type` | enum | 'internal' or 'external' |
| `spcc_completed_date` | date | Date of last completion (for external completions) |
| `last_inspection_date` | date | Date of last inspection |
| `next_inspection_due` | date | Calculated next due date |
| `inspection_frequency_days` | integer | Inspection frequency (default: 365) |

### Inspections Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Unique inspection ID |
| `facility_id` | uuid | Reference to facility |
| `conducted_at` | timestamp | When inspection was conducted |
| `status` | enum | 'draft' or 'completed' |
| `inspector_name` | text | Name of inspector |
| `responses` | jsonb | Inspection question responses |
| `signature_data` | text | Inspector's signature |

### Inspection Status Logic

```
if spcc_completion_type exists AND spcc_completed_date exists:
    expiry_date = spcc_completed_date + 1 year
    if today > expiry_date:
        status = "EXPIRED"
    else:
        status = "INSPECTED"
else:
    // Check inspections table for valid internal inspection
    if valid_inspection_within_last_year:
        status = "INSPECTED"
    elif any_inspection_expired:
        status = "EXPIRED"
    else:
        status = "PENDING"
```

### Filtering Facilities Needing SPCC Inspections

A facility needs an SPCC Inspection if:
- It has NO completed inspection, OR
- Its last inspection is expired (1+ years old), OR
- It has no `spcc_completed_date` with a valid `spcc_completion_type`

## Survey Type Selection for Route Planning

When planning routes, users can select which type of survey to focus on:

| Survey Type | Filters To Show |
|-------------|-----------------|
| **SPCC Inspections** | Facilities needing yearly inspection (no valid inspection or expired) |
| **SPCC Plans** | Facilities needing an SPCC plan (no plan, overdue, or expiring) |

This allows users to:
1. Plan routes specifically for annual inspection trips
2. Plan routes specifically for SPCC plan site visits (new plans or renewals)

## Related Components

| Component | Purpose |
|-----------|---------|
| `SPCCPlanManager.tsx` | Manages SPCC plan uploads and displays plan status |
| `SPCCPlanUploadModal.tsx` | Modal for uploading SPCC plan PDFs |
| `SPCCComplianceValidator.tsx` | Validates SPCC compliance status |
| `FacilityInspectionsManager.tsx` | Manages inspection history for a facility |
| `InspectionForm.tsx` | Form for conducting inspections |
| `FacilitiesManager.tsx` | Master facilities list with filtering |
| `RouteResults.tsx` | Route planning results and facility lists |

## Database Tables Reference

### Related Tables

- `facilities` - Core facility data with SPCC fields
- `inspections` - Individual inspection records
- `inspection_templates` - Inspection form templates
- `spcc_compliance_tracking` - Compliance calculations and alerts
- `facility_inspection_schedules` - Inspection scheduling configuration

## API Integration Notes

All SPCC data changes made in the Facilities tab automatically propagate to:
- Route Planning tab (facility lists update in real-time)
- Survey Mode (inspection data reflects current status)
- Compliance Dashboard (compliance calculations update)

The Supabase realtime subscriptions ensure data consistency across all views.
