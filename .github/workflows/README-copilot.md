# GitHub Copilot API Setup

To enable AI-powered label mapping, you have two options:

## Option 1: OpenAI API (Recommended for now)

1. Get an OpenAI API key from https://platform.openai.com/api-keys
2. Add it as a repository secret named `OPENAI_API_KEY`
3. The workflow will automatically use it

## Option 2: GitHub Copilot API (Requires special permissions)

To use GitHub Copilot API directly:

1. Go to your GitHub App settings
2. Under "Permissions & events", enable Copilot permissions
3. The App may need to be part of GitHub Copilot for Business

Note: GitHub Copilot API access for GitHub Apps may require enterprise/business license.

## Fallback

If neither API key is available, the system will use rule-based mapping which works well for common patterns like:
- priority-1 → P1
- high-priority → P0
- medium-priority → P2
