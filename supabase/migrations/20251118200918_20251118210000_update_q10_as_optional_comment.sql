/*
  # Update Q10 to be Optional Comment Field

  1. Changes
    - Update question 10 in SPCC Inspection template
    - Mark it as optional (not requiring Yes/No)
    - Change it to a comment-only field type
    - Update question text for clarity

  2. Details
    - Question 10 is for general comments and findings
    - Should not require Yes/No compliance response
    - Only comments and photos needed
*/

-- Update question 10 to be optional and comment-only
UPDATE inspection_templates
SET questions = jsonb_set(
  questions,
  '{9}',
  '{"id": "q10", "text": "Any comments, findings or important information can be entered below?", "category": "General", "type": "comment", "optional": true}'::jsonb
)
WHERE name = 'SPCC Inspection'
AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(questions) AS q
  WHERE q->>'id' = 'q10'
);
