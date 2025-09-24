# Stage 1: LinkedIn Login Test

Simple Playwright-based LinkedIn login verification script.

## Setup

1. Install dependencies:
```bash
cd stage1
npm install
```

2. Copy environment template:
```bash
cp .env.example .env
```

3. Edit `.env` with your LinkedIn credentials:
```
LINKEDIN_EMAIL=your_email@example.com
LINKEDIN_PASSWORD=your_password
HEADLESS=false
SLOW_MO=100
```

## Usage

Run the login test:
```bash
npm start
```

Or with visible browser (for debugging):
```bash
npm run test
```

Or directly:
```bash
node src/stage1.js
```

## What it does

- Launches Playwright with stealth configurations
- Navigates to LinkedIn login page
- Enters credentials with human-like typing
- Waits for successful redirect to feed
- Displays success message and exits

## Environment Variables

- `LINKEDIN_EMAIL` - Your LinkedIn email (required)
- `LINKEDIN_PASSWORD` - Your LinkedIn password (required)  
- `HEADLESS` - Run browser in headless mode (default: false)
- `SLOW_MO` - Milliseconds delay between actions (default: 100)
- `USER_DATA_DIR` - Persistent browser session directory (optional)
- `USER_AGENT` - Custom user agent string (optional)

## Success Output

```
[2024-01-01_12-30-45] Starting LinkedIn login test...
[2024-01-01_12-30-46] Attempting login...
[2024-01-01_12-30-52] ✅ LOGIN SUCCESS! Reached LinkedIn feed.
[2024-01-01_12-30-55] 🎉 Process completed successfully!
```

## Troubleshooting

- If login fails, verify credentials in `.env`
- For CAPTCHA issues, try `HEADLESS=false` to see the browser
- Increase `SLOW_MO` value if actions are too fast
- Use `USER_DATA_DIR` to persist login sessions