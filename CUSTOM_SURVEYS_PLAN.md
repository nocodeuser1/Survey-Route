# Survey Route — Custom Surveys & Hands-Free Architecture

## The Big Picture
Before building hands-free mode, we need a flexible survey/custom fields system.
Companies need to define their own survey types, fields, and control which fields
support voice input and photo capture in hands-free mode.

## Current State
- App has hardcoded SPCC Plan + SPCC Inspection survey types
- Survey type selector exists in route planning view
- Facility data is structured around these two types
- No custom field support, no hands-free settings

## Database Schema (New Tables)

### `survey_types`
```sql
CREATE TABLE survey_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'clipboard', -- lucide icon name
  color TEXT DEFAULT '#3B82F6', -- hex color
  is_system BOOLEAN DEFAULT false, -- true for SPCC Plan, SPCC Inspection
  enabled BOOLEAN DEFAULT true,
  hands_free_enabled BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- RLS: users see their account's survey types
```

### `survey_fields`
```sql
CREATE TABLE survey_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_type_id UUID NOT NULL REFERENCES survey_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text', 'textarea', 'number', 'date', 'datetime',
    'select', 'multi_select', 'checkbox', 'photo', 'signature',
    'location', 'rating'
  )),
  options JSONB, -- for select/multi_select: ["option1", "option2", ...]
  required BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false, -- true for built-in SPCC fields
  sort_order INTEGER DEFAULT 0,
  -- Hands-free config (per-field)
  voice_input_enabled BOOLEAN DEFAULT true,
  photo_capture_enabled BOOLEAN DEFAULT false,
  -- Voice matching keywords (helps AI map speech to this field)
  voice_keywords TEXT[], -- e.g., ['containment', 'wall', 'secondary']
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- RLS: inherit from survey_type -> account
```

### `facility_survey_data`
```sql
CREATE TABLE facility_survey_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  survey_type_id UUID NOT NULL REFERENCES survey_types(id),
  field_id UUID NOT NULL REFERENCES survey_fields(id),
  value JSONB, -- flexible: string, number, array, object
  photos JSONB, -- [{url, caption, timestamp, transcript_context}]
  completed_by UUID,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(facility_id, survey_type_id, field_id) -- one value per field per facility per survey type
);
-- RLS: users see their account's data
```

## Settings UI Flow

### Settings → Survey Types
```
┌─────────────────────────────────────────┐
│ Survey Types                    [+ Add] │
├─────────────────────────────────────────┤
│ 📋 SPCC Plan           [System] [Off]  │
│    12 fields · Hands-free: disabled     │
│                                         │
│ 🔍 SPCC Inspection     [System] [On]   │
│    8 fields · Hands-free: enabled       │
│                                         │
│ 🏗️ Tank Inspection     [Custom] [On]   │
│    15 fields · Hands-free: enabled      │
│                                         │
│ 🌿 Environmental Audit [Custom] [On]   │
│    6 fields · Hands-free: disabled      │
└─────────────────────────────────────────┘
```

### Click a Survey Type → Field Configuration
```
┌─────────────────────────────────────────────────┐
│ ← SPCC Inspection                               │
│                                                  │
│ Hands-Free Mode: [████ ON]                       │
│                                                  │
│ Fields          Voice  Photo  [Toggle All]       │
├─────────────────────────────────────────────────┤
│ Tank ID           [✓]   [ ]                      │
│ Tank Type         [✓]   [ ]                      │
│ Containment Wall  [✓]   [✓]                      │
│ Corrosion Check   [✓]   [✓]                      │
│ Leak Detection    [✓]   [✓]                      │
│ Overall Condition [✓]   [ ]                      │
│ Notes             [✓]   [✓]                      │
│ Inspector Sign.   [ ]   [ ]                      │
│                                                  │
│ [+ Add Custom Field]                             │
└─────────────────────────────────────────────────┘
```

### Custom Fields (GoHighLevel-style)
- Add field: name, type (dropdown), description
- Assign to one or more survey types (or create alongside a new survey type)
- Drag-to-reorder within a survey type
- Each field gets voice_keywords for hands-free matching
- Toggle required/optional

## App-Wide Survey Type Filtering

### How it works everywhere:
1. **Survey type selector** (already exists in route planning, extend to facilities tab)
2. When a survey type is active:
   - **Facilities tab**: clicking a facility shows ONLY fields for that survey type
   - **Route planning map**: clicking a facility marker shows survey-type fields
   - **Facility list**: shows completion status for active survey type
   - **Hands-free mode**: uses that survey type's field config for voice/photo mapping

### Facility Click → Survey-Type-Specific View
```
┌──────────────────────────────────┐
│ Facility: Oklahoma Tank Farm #3  │
│ Survey: SPCC Inspection          │
│                                  │
│ Tank ID: TK-003          [✓]    │
│ Tank Type: AST 500gal    [✓]    │
│ Containment: Good        [✓]    │
│ Corrosion: Minor surface [ ]    │
│ Leak Detection: Pass     [✓]    │
│ Photos: 3 attached              │
│                                  │
│ [🎤 Hands-Free]  [💾 Save]     │
└──────────────────────────────────┘
```

## Migration Strategy for Existing SPCC Data
- Create system survey types for SPCC Plan + SPCC Inspection on first run
- Map existing hardcoded SPCC fields → survey_fields rows (is_system=true)
- Existing facility SPCC data stays in current columns (backward compatible)
- New custom survey data goes into facility_survey_data table
- Long-term: migrate SPCC data into facility_survey_data too

## Build Phases

### Phase 1: DB Schema + Survey Types CRUD
- Create all 3 new tables with RLS
- Seed system survey types (SPCC Plan, SPCC Inspection) with their fields
- Settings UI: list survey types, add/edit/delete custom types
- Enable/disable toggle per survey type

### Phase 2: Custom Fields System
- Settings UI: field management per survey type
- Add/edit/delete custom fields with all field types
- Drag-to-reorder
- GoHighLevel-style: fields belong to survey types like folders

### Phase 3: Hands-Free Settings
- Per-survey-type hands-free enable toggle
- Per-field voice input + photo capture toggles
- Toggle all on/off buttons
- Voice keywords configuration per field

### Phase 4: Survey Type Filtering (App-Wide)
- Survey type selector in facilities tab (not just route planning)
- Facility detail view filters to active survey type's fields
- Map popup shows survey-type-specific fields
- Completion tracking per survey type per facility

### Phase 5: Facility Survey Data Entry
- Form UI for entering data against custom fields
- Photo attachment per field
- Save to facility_survey_data table
- View/edit existing survey data

### Phase 6: Hands-Free Mode Component
- Full-screen voice UI
- Continuous speech recognition
- Voice commands (take picture, next, skip, done)
- Real-time transcript
- Field mapping from speech context
- Photo capture with auto-caption

### Phase 7: Capacitor Native Build
- Capacitor setup (iOS + Android)
- Native camera plugin
- Voice-triggered camera
- Background audio
- CI/CD workflows
