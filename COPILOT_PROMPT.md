# GitHub Copilot Prompt for Label Mapping

Use this prompt in GitHub Copilot Chat (at github.com/copilot or in your editor) to generate intelligent label-to-field mappings.

## Prompt Template

```
I need help mapping GitHub issue labels to structured issue fields for repository @OWNER/REPO.

**Available Issue Fields:**
[List your fields here with their options, e.g.:
- Priority: P0, P1, P2, P3
- Status: Backlog, In Progress, Done
]

**Current Labels in Repository:**
[List your labels here with descriptions/colors, e.g.:
- needs-triage (red) - Urgent issues needing immediate attention
- high-priority (orange) - Important issues
- weekend-project (purple) - Low priority, nice to have
- working-on-it (yellow) - Currently being worked on
- completed (green) - Finished work
]

**Custom Instructions:**
[Optional: Add any specific mapping preferences, e.g.:
- Map 'needs-triage' to P0 because it's most urgent
- Map 'weekend-project' to P3 since it's low priority
]

Please analyze these labels and create intelligent mappings. Consider:
1. Semantic meaning of label names and descriptions
2. Color psychology (red=urgent, green=done, etc.)
3. Priority levels (lower numbers = higher priority)
4. Status workflow (todo → in progress → done)

Respond ONLY with valid JSON in this exact format:
```json
{
  "Priority": {
    "needs-triage": "P0",
    "high-priority": "P1",
    "weekend-project": "P3"
  },
  "Status": {
    "working-on-it": "In Progress",
    "completed": "Done"
  }
}
```
```

## Example Complete Prompt

```
I need help mapping GitHub issue labels to structured issue fields for repository @akenneth-test-org/test-repo-1.

**Available Issue Fields:**
- Priority: P0 (Critical), P1 (High), P2 (Medium), P3 (Low), p3, p4, p5
- Status: Backlog, In Progress, Done

**Current Labels in Repository:**
- needs-triage (red) - Urgent issues needing immediate attention
- high-priority (orange) - Important issues  
- medium-priority (yellow) - Standard priority
- p1 (orange) - Priority level 1
- p2 (yellow) - Priority level 2
- priority-1 (orange) - First priority
- priority-2 (yellow) - Second priority

**Custom Instructions:**
Map 'needs-triage' to P0 because it requires immediate action. Map numeric priorities directly (p1→P1, p2→P2).

Please analyze these labels and create intelligent mappings. Consider semantic meaning, colors, and priority conventions.

Respond ONLY with valid JSON in this exact format:
```json
{
  "FieldName": {
    "label-name": "FieldValue"
  }
}
```
```

## How to Use the Result

1. Copy the JSON response from Copilot
2. Go to your migration issue
3. Comment: `@issue-fields-migrator use mapping` followed by the JSON
4. The bot will validate and use your Copilot-generated mappings

Example:
```
@issue-fields-migrator use mapping
```json
{
  "Priority": {
    "needs-triage": "P0",
    "high-priority": "P1",
    "weekend-project": "P3"
  }
}
```
```
