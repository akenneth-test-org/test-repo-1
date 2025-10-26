# GitHub Copilot Prompt for Label Mapping

Use this prompt in GitHub Copilot Chat (at github.com/copilot or in your editor) to generate intelligent label-to-field mappings.

## 🤖 Smart Prompt (Recommended)

**Copilot will fetch labels and fields automatically:**

```
I need help mapping GitHub issue labels to structured issue fields for repository @OWNER/REPO.

Please:
1. Fetch all labels from this repository
2. Fetch all issue fields for this repository/organization
3. Analyze the labels and fields
4. Create intelligent mappings based on:
   - Semantic meaning of label names and descriptions
   - Color psychology (red=urgent/high, yellow=medium, green=low/done, etc.)
   - Priority conventions (lower numbers = higher priority, p1 > p2)
   - Status workflow patterns (todo → in progress → done)
   - Common naming patterns (priority-*, status-*, type-*)

**Custom Instructions (optional):**
[Add any specific mapping preferences, e.g.:
- Map 'needs-triage' to P0 because it requires immediate attention
- Map 'weekend-project' to P3 since it's low priority
- Don't map 'bug' or 'feature' labels
]

Respond ONLY with valid JSON in this exact format:
```json
{
  "FieldName": {
    "label-name": "FieldValue",
    "another-label": "AnotherValue"
  }
}
```

Example output:
```json
{
  "Priority": {
    "needs-triage": "P0",
    "high-priority": "P1",
    "medium-priority": "P2",
    "p1": "P1",
    "p2": "P2"
  },
  "Status": {
    "working-on-it": "In Progress",
    "completed": "Done"
  }
}
```
```

## 📋 Example Usage

```
I need help mapping GitHub issue labels to structured issue fields for repository @akenneth-test-org/test-repo-1.

Please:
1. Fetch all labels from this repository
2. Fetch all issue fields for this repository/organization  
3. Analyze the labels and fields
4. Create intelligent mappings

Custom Instructions:
- Map 'needs-triage' to P0 because it requires immediate attention
- Map numeric priorities directly (p1→P1, p2→P2)
- Ignore generic labels like 'bug', 'feature', 'documentation'

Respond ONLY with valid JSON in this exact format:
```json
{
  "FieldName": {
    "label-name": "FieldValue"
  }
}
```
```

## 🎯 How to Use the Result

1. **Copy the prompt above** and replace `@OWNER/REPO` with your repository
2. **Go to** [github.com/copilot](https://github.com/copilot) or use Copilot in your editor
3. **Paste the prompt** and wait for Copilot to analyze
4. **Copy the JSON response** from Copilot
5. **Go to your migration issue** in the repository
6. **Comment:**
   ```
   @issue-fields-migrator use mapping
   ```json
   {
     "Priority": {
       "high-priority": "P1",
       "needs-triage": "P0"
     }
   }
   ```
   ```
7. **The bot will validate and use** your Copilot-generated mappings!

## 💡 Tips

- Copilot can see your repository context when you @ mention it
- The more specific your custom instructions, the better the mapping
- You can iterate - if the mapping isn't perfect, refine your prompt and try again
- Copilot understands semantic meaning, not just text matching

## 🔄 Alternative: Manual Context (if needed)

If Copilot can't fetch the data automatically, provide it manually:

```
I need help mapping GitHub issue labels to structured issue fields for repository @OWNER/REPO.

**Available Issue Fields:**
- Priority: P0 (Critical), P1 (High), P2 (Medium), P3 (Low)
- Status: Backlog, In Progress, Done

**Current Labels in Repository:**
- needs-triage (red) - Urgent issues needing immediate attention
- high-priority (orange) - Important issues  
- working-on-it (yellow) - Currently being worked on
- completed (green) - Finished work

Create intelligent mappings. Respond ONLY with JSON:
```json
{
  "FieldName": {
    "label-name": "FieldValue"
  }
}
```
```
```
