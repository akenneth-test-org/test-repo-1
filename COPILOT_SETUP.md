# GitHub Copilot Integration Setup

The Issue Fields Migrator uses GitHub Copilot for intelligent, AI-powered label mapping.

## Setup Instructions

### Option 1: Use Personal Access Token with Copilot (Recommended)

1. Go to https://github.com/settings/tokens/new
2. Create a token with these scopes:
   - `copilot` (GitHub Copilot access)
   - `read:org` (to access organization data)
3. Add the token as a repository secret named `COPILOT_TOKEN`
4. Update the workflow to use this token

### Option 2: Use GitHub App with Copilot (Enterprise Only)

If your organization has GitHub Copilot Enterprise, the GitHub App can use Copilot directly.
This requires special configuration and may not be available for all organizations.

## Features

With Copilot enabled, you can:

- **Use natural language prompts**: 
  - "@issue-fields-migrator analyze Map 'needs-triage' to P0 because it's urgent"
  - "@issue-fields-migrator Map 'weekend-project' to P3 since it's low priority"

- **Get intelligent semantic understanding**:
  - Copilot understands context and meaning, not just pattern matching
  - It considers label colors, descriptions, and field meanings

- **Refine with natural feedback**:
  - "@issue-fields-migrator Map high-priority to P1 instead"
  - Copilot understands your intent and adjusts mappings

## Current Status

Without Copilot token configured, the system uses rule-based mapping which works well for:
- Standard patterns like `priority-1` → `P1`
- Color-based inference (red = high priority)
- Common label naming conventions
