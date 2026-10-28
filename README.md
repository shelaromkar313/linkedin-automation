# LinkedIn AI Connect Assistant (Manifest V3) + Autopilot Outreach System

A **100% free (0 Rs)**, enterprise-grade LinkedIn outreach and lead management system built for standard (free) LinkedIn accounts. It completely eliminates manual searching and messaging while avoiding paid InMail / Sales Navigator paywalls.

---

## 🌟 Key Features & Workflow

### 1. ⏰ Hands-Free 8:00 AM Daily Outreach
- Uses Chrome Background Service Worker (`background.js` & `chrome.alarms`) to automatically fire every morning at **8:00 AM**.
- Automatically launches LinkedIn search for target decision-makers without your boss needing to press any buttons.
- Safe daily quota capped at 15–20 requests/day to keep free LinkedIn accounts 100% safe.

### 2. 🎯 Pune CEO & 150+ Employee Filtering
- **Geo-targeting**: Automatically applies Pune Geographic URN (`geoUrn=["103644278"]`) on free search results.
- **Headcount Validation**: Automatically validates company headcount on candidate profiles (150+ employees). If a startup is below threshold (< 150), it intelligently skips to preserve daily quota.

### 3. 🛡️ InMail & Paywall Protection (Hero Card Isolation)
- **Scoped Hero Query**: Restricts DOM searches strictly to the candidate's top header card (`getMainProfileCard()`).
- Excludes right-side suggestions ("More profiles for you", "People you may know", "Explore Premium") so it never clicks the wrong people.
- Never clicks paid InMail "Message" buttons that trigger the "Job search smarter with Premium" paywall.
- **Workflow**:
  1. Checks for primary **Connect** button on the hero card.
  2. If hidden, clicks **... More** button and selects **Connect** from the dropdown.
  3. Clicks **Add a note**, inserts tailored note via React input simulation, and sends.
  4. Follows candidate account.

### 4. 📊 Free CRM Lead Tracker & 1-Click CSV Export
- Automatically logs all outreach in local browser storage (`chrome.storage.local`):
  - Target Name, Headline, Company, Location (Pune), Profile URL, Sent Timestamp, Status (`Pending` vs `Accepted`).
- Live stats dashboard inside the popup:
  - **Sent** | **Pending** | **Accepted** | **Messaged**
- **📥 Download CSV / Excel**: Generates clean spreadsheet report for your boss with a single click.

### 5. 🤝 Auto-Detect Acceptances & Free Follow-Up Messaging
- 1-Click check (`btnCheckAccepted`) or automatic trigger on `linkedin.com/mynetwork/invite-connect/connections/`.
- Scans newly accepted 1st-degree connections against pending leads.
- Automatically marks status as **Accepted** and sends a warm follow-up message (100% free since they are now 1st-degree connections).

---

## 📁 Project Structure

```
linkedin-automation/
├── manifest.json       # Manifest V3 (alarms, storage, background service worker)
├── background.js       # 8:00 AM daily scheduler & background automation engine
├── content.js          # LinkedIn DOM manipulator, hero-isolation, React input syncer
├── popup.html          # Control panel, Pune CEO presets, CRM dashboard & CSV export
├── popup.js            # Controller, Gemini model manager, CRM exporter
├── icons/              # Extension icons (16px, 48px, 128px)
└── README.md           # Documentation
```

---

## 🚀 Quick Setup Instructions

### Step 1: Reload Extension in Chrome
1. Open Google Chrome and go to `chrome://extensions/`.
2. Ensure **Developer mode** (top-right) is **ON**.
3. Locate **LinkedIn AI Connect Assistant** and click the **Reload icon (↻)** (or click **Load unpacked** and select `q:\Projects new\linkedin-automation`).

### Step 2: Configure & Verify Settings
1. Click the extension icon in your Chrome toolbar.
2. Confirm the preset:
   - **Target Query**: `CEO`
   - **Min Employees**: `150`
   - **Max / Day**: `15`
   - **⏰ Run Automatically Every Morning at 8:00 AM**: Checked (`ON`)
3. (Optional) In **Configuration & Pitch Context**, paste a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey) (or leave blank to use smart personalized templates).

### Step 3: Run Outreach
- **Manual Launch**: Click **"🚀 Start Autopilot for Pune CEOs"** at any time.
- **Automatic Daily Run**: Keep your browser open or pinned; at 8:00 AM daily, the extension will automatically launch and execute outreach.
- **Reporting**: Click **"📥 Download CSV / Excel"** in the popup to hand the complete outreach report to your boss.
